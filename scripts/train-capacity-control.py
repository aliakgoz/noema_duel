#!/usr/bin/env python3
"""A near-parameter-matched feedforward control for the isolated GRU trial.

Keep separate from the frozen four-policy experiment. This control changes
hidden widths/depth and uses independent seeded Xavier initialization, so it
reduces the parameter-count confound without isolating recurrence perfectly.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import time
from pathlib import Path

import torch
from torch import Tensor, nn
from torch.nn import functional as F


class CapacityPolicy(nn.Module):
    architecture = "capacity-mlp"

    def __init__(self) -> None:
        super().__init__()
        self.fc1 = nn.Linear(160, 192)
        self.fc2 = nn.Linear(192, 192)
        self.fc3 = nn.Linear(192, 48)
        self.head = nn.Linear(48, 6)
        for layer in (self.fc1, self.fc2, self.fc3, self.head):
            nn.init.xavier_uniform_(layer.weight)
            nn.init.zeros_(layer.bias)
        assert sum(parameter.numel() for parameter in self.parameters()) == 77526

    def forward(self, observations: Tensor, maps: Tensor, mask: Tensor) -> Tensor:
        return self.head(torch.tanh(self.fc3(torch.tanh(self.fc2(torch.tanh(self.fc1(observations)))))))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("artifacts/gru-experiment/dataset.json"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/gru-experiment/capacity-control"))
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--seeds", type=int, nargs="+", default=[42, 123])
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=0.003)
    args = parser.parse_args()
    if min(args.epochs, args.threads, args.batch_size) <= 0 or args.learning_rate <= 0:
        parser.error("Training budgets must be positive")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    spec = importlib.util.spec_from_file_location("noema_gru_experiment", Path(__file__).with_name("train-gru-experiment.py"))
    assert spec is not None and spec.loader is not None
    trainer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(trainer)
    source, episodes, dataset_hash = trainer.load_dataset(args.data)
    train = [episode for episode in episodes if episode["split"] == "train"]
    train_timesteps = sum(len(episode["actions"]) for episode in train)
    started = time.perf_counter()
    config = {"epochs": args.epochs, "seeds": args.seeds, "threads": args.threads, "batchSize": args.batch_size,
              "learningRate": args.learning_rate, "gradientClipNorm": 5, "device": "cpu", "torchVersion": torch.__version__,
              "deterministicAlgorithms": True, "datasetSHA256": dataset_hash,
              "trainEpisodes": len(train), "trainTimestepsPerEpoch": train_timesteps,
              "checkpointSelection": "Final predeclared epoch; held-out splits never used for optimization or selection",
              "controlLimit": "Near parameter matched (77526 vs 77926); widths, depth and initialization differ, so not a pure recurrence intervention"}
    bundle = {"schemaVersion": 1, "observationSize": 160, "mapShape": [16, 20, 20],
              "mapChannelNames": source.get("mapChannelNames", []), "startedAt": trainer.utc_now(), "config": config, "models": []}
    summary = {key: value for key, value in bundle.items() if key != "models"}
    summary["models"] = []
    for seed in args.seeds:
        torch.manual_seed(seed)
        policy = CapacityPolicy()
        schedule = trainer.episode_schedule(train, args.epochs, args.batch_size, seed)
        sanity = trainer.sanity_check(policy, trainer.make_batch([train[index] for index in schedule[0][0]], False))
        optimizer = torch.optim.Adam(policy.parameters(), lr=args.learning_rate)
        history = []
        optimizer_updates = 0
        model_start = time.perf_counter()
        for epoch, batches in enumerate(schedule, start=1):
            policy.train()
            loss_sum, correct, count = 0.0, 0, 0
            for indices in batches:
                observations, maps, actions, mask = trainer.make_batch([train[index] for index in indices], False)
                optimizer.zero_grad(set_to_none=True)
                logits = policy(observations, maps, mask)
                loss = F.cross_entropy(logits[mask], actions[mask])
                if not torch.isfinite(loss):
                    raise RuntimeError("Non-finite capacity-control training loss")
                loss.backward()
                torch.nn.utils.clip_grad_norm_(policy.parameters(), 5, error_if_nonfinite=True)
                optimizer.step()
                valid = int(mask.sum())
                loss_sum += float(loss.detach()) * valid
                correct += int(((logits.detach().argmax(dim=-1) == actions) & mask).sum())
                count += valid
                optimizer_updates += 1
            assert count == train_timesteps
            entry = {"epoch": epoch, "loss": loss_sum / count, "accuracy": correct / count,
                     "elapsedSeconds": time.perf_counter() - model_start}
            history.append(entry)
            if epoch == 1 or epoch % 10 == 0 or epoch == args.epochs:
                print(json.dumps({"event": "epoch", "architecture": "capacity-mlp", "seed": seed, **entry}), flush=True)
        duration = time.perf_counter() - model_start
        metrics = trainer.evaluate_teacher_forced(policy, episodes, args.batch_size)
        metadata = {"id": f"capacity-mlp-seed{seed}", "architecture": "capacity-mlp", "seed": seed, "parameterCount": 77526,
                    "training": {"epochs": args.epochs, "optimizerUpdates": optimizer_updates,
                                 "maskedTimestepsSeen": train_timesteps * args.epochs, "durationSeconds": duration,
                                 "sanity": sanity, "history": history, "teacherForced": metrics,
                                 "initializationSource": "Independent seeded PyTorch Xavier-uniform; zero biases; incompatible widths preclude shared old weights"}}
        bundle["models"].append({**metadata, "stateDict": trainer.export_state(policy), "parity": trainer.parity_cases(policy, episodes)})
        summary["models"].append(metadata)
        trainer.atomic_json(args.output / "models.json", bundle)
        trainer.atomic_json(args.output / "training-summary.json", summary)
        print(json.dumps({"event": "model-complete", "id": metadata["id"], "durationSeconds": duration, "teacherForced": metrics}), flush=True)
    for document in (bundle, summary):
        document["finishedAt"] = trainer.utc_now()
        document["durationSeconds"] = time.perf_counter() - started
    trainer.atomic_json(args.output / "models.json", bundle)
    trainer.atomic_json(args.output / "training-summary.json", summary)


if __name__ == "__main__":
    main()
