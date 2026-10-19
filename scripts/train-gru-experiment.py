#!/usr/bin/env python3
"""Train the four NOEMA comparison policies with genuine CPU autograd/BPTT.

This is an isolated experiment. It never updates the game's live model, arena
rules, or player saves. Demonstrations come from the companion dataset exporter;
all held-out splits are evaluation-only, and checkpoints are the final epoch.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from torch import Tensor, nn
from torch.nn import functional as F


ARCHITECTURES = ("mlp", "gru", "map", "residual-map-gru")
EXPECTED_PARAMETERS = {"mlp": 14854, "gru": 77926, "map": 41934, "residual-map-gru": 101902}
SPLITS = ("train", "test-start", "test-layout", "test-room")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        stream.write("\n")
    os.replace(temporary, path)


class MapEncoder(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(16, 16, kernel_size=3, stride=2, padding=1)
        self.conv2 = nn.Conv2d(16, 24, kernel_size=3, stride=2, padding=1)
        self.fc = nn.Linear(600, 32)

    def forward(self, maps: Tensor) -> Tensor:
        values = F.relu(self.conv1(maps))
        values = F.relu(self.conv2(values))
        return torch.tanh(self.fc(values.flatten(start_dim=1)))


class Policy(nn.Module):
    def __init__(self, architecture: str) -> None:
        super().__init__()
        self.architecture = architecture
        if architecture == "gru":
            self.fc1 = nn.Linear(160, 96)
            self.gru = nn.GRU(96, 96, batch_first=True)
            self.fc2 = nn.Linear(96, 64)
        else:
            self.fc1 = nn.Linear(160, 64)
            self.fc2 = nn.Linear(64, 64)
            if architecture in ("map", "residual-map-gru"):
                self.mapEncoder = MapEncoder()
                if architecture == "residual-map-gru":
                    self.gru = nn.GRU(96, 96, batch_first=True)
                    self.projection = nn.Linear(96, 64, bias=False)
                else:
                    self.projection = nn.Linear(32, 64, bias=False)
                nn.init.zeros_(self.projection.weight)
        self.head = nn.Linear(64, 6)
        # Match the current policy's Xavier-uniform / zero-bias initialization.
        for layer in (self.fc1, self.fc2, self.head):
            nn.init.xavier_uniform_(layer.weight)
            nn.init.zeros_(layer.bias)

    def forward(self, observations: Tensor, maps: Tensor, mask: Tensor) -> Tensor:
        """Complete episodes; recurrent state starts at zero for every row.

        Padding is a suffix only and never contributes to the objective. No
        previous target action or future observation is supplied as an input.
        The GRU's history consists exclusively of its past/current observations.
        """
        first = torch.tanh(self.fc1(observations))
        if self.architecture == "gru":
            recurrent, _ = self.gru(first)
            second = self.fc2(recurrent)
        else:
            second = self.fc2(first)
            if self.architecture in ("map", "residual-map-gru"):
                # Avoid convolution on padded time steps without breaking the
                # encoder's autograd path through the indexed assignment.
                map_features = observations.new_zeros((*mask.shape, 32))
                map_features[mask] = self.mapEncoder(maps[mask])
                if self.architecture == "residual-map-gru":
                    recurrent, _ = self.gru(torch.cat((first, map_features), dim=-1))
                    second = second + self.projection(recurrent)
                else:
                    second = second + self.projection(map_features)
        return self.head(torch.tanh(second))


def initialize_policy(architecture: str, seed: int, shared_old_state: dict[str, Tensor]) -> Policy:
    torch.manual_seed(seed)
    policy = Policy(architecture)
    if architecture != "gru":
        # The three comparable policies start with identical existing-network
        # weights. Zero residuals preserve exactly the old policy at time zero.
        policy.load_state_dict(shared_old_state, strict=architecture == "mlp")
    else:
        # This policy has different hidden dimensions, but its compatible action
        # head can still start identically to the common baseline.
        with torch.no_grad():
            policy.head.weight.copy_(shared_old_state["head.weight"])
            policy.head.bias.copy_(shared_old_state["head.bias"])
    actual = sum(parameter.numel() for parameter in policy.parameters())
    if actual != EXPECTED_PARAMETERS[architecture]:
        raise ValueError(f"{architecture}: {actual} parameters, expected {EXPECTED_PARAMETERS[architecture]}")
    return policy


def initial_old_state(source: dict[str, Any], seed: int) -> tuple[dict[str, Tensor], str]:
    """Use the exact game's seeded initialization when the exporter supplies it."""
    torch.manual_seed(seed)
    state = copy.deepcopy(Policy("mlp").state_dict())
    snapshot = source.get("initialMlpSnapshots", {}).get(str(seed))
    if snapshot is None:
        return state, "New common PyTorch Xavier initialization; not an existing player profile"
    if snapshot.get("architecture") != [160, 64, 64, 6]:
        raise ValueError(f"Invalid common initial snapshot architecture for seed {seed}")
    for index, name in enumerate(("fc1", "fc2", "head")):
        for target, values in ((f"{name}.weight", snapshot["weights"][index]), (f"{name}.bias", snapshot["biases"][index])):
            tensor = torch.tensor(values, dtype=torch.float32)
            if tensor.numel() != state[target].numel() or not torch.isfinite(tensor).all():
                raise ValueError(f"Invalid common initial snapshot: {seed}/{target}")
            state[target] = tensor.reshape(state[target].shape)
    return state, "Exact untrained TinyNetwork initialization exported for this seed; not a trained player profile"


def recurrence_sanity() -> dict[str, Any]:
    """A delayed cue needs a real recurrent gradient and retained information.

    Terminal observations are identical for both balanced classes; a policy
    without memory has a 50% ceiling here, regardless of terminal MLP size.
    This checks implementation mechanics, not puzzle generalization.
    """
    torch.manual_seed(2026)
    policy = Policy("gru")
    observations = torch.zeros((2, 6, 160), dtype=torch.float32)
    observations[0, 0, 0] = -1
    observations[1, 0, 0] = 1
    observations[:, -1, 1] = 1
    observations.requires_grad_(True)
    targets = torch.tensor([0, 1], dtype=torch.long)
    mask = torch.ones((2, 6), dtype=torch.bool)
    maps = torch.empty(0)
    initial_loss = F.cross_entropy(policy(observations, maps, mask)[:, -1], targets)
    initial_loss.backward()
    cue_gradient = float(observations.grad[:, 0, 0].abs().sum())
    if not math.isfinite(cue_gradient) or cue_gradient <= 1e-10:
        raise RuntimeError("Recurrent sanity: terminal loss did not backpropagate to the six-step-old cue")
    observations = observations.detach()
    optimizer = torch.optim.Adam(policy.parameters(), lr=0.01)
    for _ in range(120):
        optimizer.zero_grad(set_to_none=True)
        logits = policy(observations, maps, mask)[:, -1]
        loss = F.cross_entropy(logits, targets)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(policy.parameters(), 5, error_if_nonfinite=True)
        optimizer.step()
    with torch.no_grad():
        logits = policy(observations, maps, mask)[:, -1]
        accuracy = float((logits.argmax(dim=-1) == targets).float().mean())
        final_loss = float(F.cross_entropy(logits, targets))
    if accuracy != 1 or not math.isfinite(final_loss):
        raise RuntimeError(f"Recurrent sanity: failed to retain delayed cue ({accuracy})")
    return {"passed": True, "sequenceLength": 6, "balancedTerminalExamples": 2,
            "terminalObservationIdentical": True, "memorylessAccuracyCeiling": 0.5,
            "terminalLossGradientAtInitialCue": cue_gradient,
            "trainingSteps": 120, "terminalAccuracy": accuracy, "terminalLoss": final_loss,
            "scope": "BPTT and memory implementation sanity; not a puzzle performance claim"}


def load_dataset(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    raw = path.read_bytes()
    source = json.loads(raw)
    if source.get("observationSize") != 160 or source.get("mapShape") != [16, 20, 20]:
        raise ValueError("Dataset must contain 160 observations and CHW mapShape [16,20,20]")
    episodes: list[dict[str, Any]] = []
    identifiers: set[str] = set()
    for record in source["episodes"]:
        identifier = str(record["id"])
        if identifier in identifiers:
            raise ValueError(f"Duplicate episode id: {identifier}")
        identifiers.add(identifier)
        if record["split"] not in SPLITS or record.get("solved") is not True:
            raise ValueError(f"Unsolved episode or invalid split: {identifier}")
        actions = record["actions"]
        if not actions or len(actions) != len(record["observations"]) or len(actions) != len(record["mapSparse"]):
            raise ValueError(f"Mismatched episode lengths: {identifier}")
        observations = torch.tensor(record["observations"], dtype=torch.float32)
        if tuple(observations.shape) != (len(actions), 160) or not torch.isfinite(observations).all():
            raise ValueError(f"Invalid observation tensor: {identifier}")
        if any(type(action) is not int or action < 0 or action > 5 for action in actions):
            raise ValueError(f"Invalid action: {identifier}")
        maps = torch.zeros((len(actions), 6400), dtype=torch.float32)
        for step, sparse in enumerate(record["mapSparse"]):
            if len(sparse) % 2:
                raise ValueError(f"Sparse map requires index/value pairs: {identifier}/{step}")
            indices = sparse[0::2]
            values = sparse[1::2]
            if any(type(index) is not int or index < 0 or index >= 6400 for index in indices):
                raise ValueError(f"Invalid map index: {identifier}/{step}")
            if len(indices) != len(set(indices)) or any(not math.isfinite(float(value)) for value in values):
                raise ValueError(f"Invalid sparse map values: {identifier}/{step}")
            maps[step, indices] = torch.tensor(values, dtype=torch.float32)
        episodes.append({
            "id": identifier,
            "split": record["split"],
            "observations": observations,
            "maps": maps.view(len(actions), 16, 20, 20),
            "actions": torch.tensor(actions, dtype=torch.long),
            "source": record,
        })
    if not any(episode["split"] == "train" for episode in episodes):
        raise ValueError("No training episodes")
    return source, episodes, hashlib.sha256(raw).hexdigest()


def make_batch(episodes: list[dict[str, Any]], include_maps: bool) -> tuple[Tensor, Tensor, Tensor, Tensor]:
    batch_size = len(episodes)
    longest = max(len(episode["actions"]) for episode in episodes)
    observations = torch.zeros((batch_size, longest, 160), dtype=torch.float32)
    maps = torch.zeros((batch_size, longest, 16, 20, 20), dtype=torch.float32) if include_maps else torch.empty(0)
    actions = torch.zeros((batch_size, longest), dtype=torch.long)
    mask = torch.zeros((batch_size, longest), dtype=torch.bool)
    for row, episode in enumerate(episodes):
        length = len(episode["actions"])
        observations[row, :length] = episode["observations"]
        if include_maps:
            maps[row, :length] = episode["maps"]
        actions[row, :length] = episode["actions"]
        mask[row, :length] = True
    return observations, maps, actions, mask


def episode_schedule(episodes: list[dict[str, Any]], epochs: int, batch_size: int, seed: int) -> list[list[list[int]]]:
    # A separate Python RNG makes the exact episode order independent of model
    # initialization, parameter count, and PyTorch's internal random calls.
    generator = random.Random(seed + 104729)
    schedules: list[list[list[int]]] = []
    for _ in range(epochs):
        order = list(range(len(episodes)))
        generator.shuffle(order)
        schedules.append([order[start:start + batch_size] for start in range(0, len(order), batch_size)])
    return schedules


def sanity_check(policy: Policy, batch: tuple[Tensor, Tensor, Tensor, Tensor]) -> dict[str, Any]:
    initial = copy.deepcopy(policy.state_dict())
    observations, maps, actions, mask = batch
    optimizer = torch.optim.Adam(policy.parameters(), lr=1e-4)
    policy.train()
    optimizer.zero_grad(set_to_none=True)
    logits = policy(observations, maps, mask)
    before = F.cross_entropy(logits[mask], actions[mask])
    before.backward()
    gradients = [parameter.grad for parameter in policy.parameters()]
    if not torch.isfinite(before) or any(gradient is None or not torch.isfinite(gradient).all() for gradient in gradients):
        raise RuntimeError("Sanity check failed: loss/gradient not finite or disconnected parameter")
    gradient_l1 = sum(float(gradient.abs().sum()) for gradient in gradients if gradient is not None)
    if gradient_l1 <= 0:
        raise RuntimeError("Sanity check failed: zero total gradient")
    optimizer.step()
    with torch.no_grad():
        after = F.cross_entropy(policy(observations, maps, mask)[mask], actions[mask])
    if not torch.isfinite(after) or float(after) >= float(before.detach()):
        raise RuntimeError(f"Sanity check failed: one small Adam step did not lower loss ({float(before.detach())} -> {float(after)})")
    policy.load_state_dict(initial)
    policy.zero_grad(set_to_none=True)
    return {"finiteGradients": True, "gradientL1": gradient_l1, "beforeLoss": float(before.detach()), "afterOneStepLoss": float(after)}


@torch.no_grad()
def evaluate_teacher_forced(policy: Policy, episodes: list[dict[str, Any]], batch_size: int) -> dict[str, Any]:
    policy.eval()
    results: dict[str, Any] = {}
    include_maps = policy.architecture in ("map", "residual-map-gru")
    for split in SPLITS:
        selected = [episode for episode in episodes if episode["split"] == split]
        loss_sum = 0.0
        correct = 0
        count = 0
        exact_episodes = 0
        for start in range(0, len(selected), batch_size):
            batch = make_batch(selected[start:start + batch_size], include_maps)
            observations, maps, actions, mask = batch
            logits = policy(observations, maps, mask)
            loss_sum += float(F.cross_entropy(logits[mask], actions[mask], reduction="sum"))
            predictions = logits.argmax(dim=-1)
            correct += int(((predictions == actions) & mask).sum())
            count += int(mask.sum())
            exact_episodes += int(((predictions == actions) | ~mask).all(dim=1).sum())
        results[split] = {
            "episodes": len(selected), "timesteps": count,
            "loss": loss_sum / count if count else None,
            "accuracy": correct / count if count else None,
            "exactDemonstrationEpisodes": exact_episodes,
            "warning": "Teacher-forced imitation accuracy; not closed-loop puzzle completion.",
        }
    return results


@torch.no_grad()
def parity_cases(policy: Policy, episodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    policy.eval()
    selected: list[dict[str, Any]] = []
    for split in ("train", "test-room"):
        candidate = next((episode for episode in episodes if episode["split"] == split and len(episode["actions"]) >= 5), None)
        if candidate is not None:
            selected.append(candidate)
    cases: list[dict[str, Any]] = []
    for episode in selected:
        length = min(5, len(episode["actions"]))
        truncated = dict(episode)
        for key in ("observations", "maps", "actions"):
            truncated[key] = episode[key][:length]
        observations, maps, _, mask = make_batch([truncated], policy.architecture in ("map", "residual-map-gru"))
        logits = policy(observations, maps, mask)[0].tolist()
        cases.append({"episodeId": episode["id"], "steps": [
            {"observation": episode["source"]["observations"][step],
             "mapSparse": episode["source"]["mapSparse"][step], "logits": logits[step]}
            for step in range(length)
        ]})
    return cases


def export_state(policy: Policy) -> dict[str, Any]:
    return {name: {"shape": list(value.shape), "values": value.detach().cpu().flatten().tolist()}
            for name, value in policy.state_dict().items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("artifacts/gru-experiment/dataset.json"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/gru-experiment"))
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--seeds", type=int, nargs="+", default=[42, 123])
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=0.003)
    parser.add_argument("--architectures", "--models", dest="architectures", nargs="+", choices=ARCHITECTURES, default=list(ARCHITECTURES))
    parser.add_argument("--skip-evaluation", action="store_true", help="Performance pilot only; skip teacher-forced split metrics")
    args = parser.parse_args()
    if args.epochs <= 0 or args.threads <= 0 or args.batch_size <= 0 or not math.isfinite(args.learning_rate) or args.learning_rate <= 0:
        parser.error("epochs, threads, batch size and learning rate must be positive")
    if len(args.seeds) != len(set(args.seeds)) or len(args.architectures) != len(set(args.architectures)):
        parser.error("seeds and architectures must be unique")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    sanity_memory = recurrence_sanity()
    print(json.dumps({"event": "recurrence-sanity", **sanity_memory}), flush=True)
    source, episodes, dataset_hash = load_dataset(args.data)
    train = [episode for episode in episodes if episode["split"] == "train"]
    train_timesteps = sum(len(episode["actions"]) for episode in train)
    started = utc_now()
    wall_start = time.perf_counter()
    config = {"epochs": args.epochs, "seeds": args.seeds, "threads": args.threads,
              "batchSize": args.batch_size, "learningRate": args.learning_rate, "gradientClipNorm": 5,
              "architectures": args.architectures, "torchVersion": torch.__version__, "device": "cpu",
              "deterministicAlgorithms": True, "sequenceTraining": "Full episode BPTT; zero hidden state per episode; suffix padding masked",
              "skipTeacherForcedEvaluation": args.skip_evaluation,
              "checkpointSelection": "Final fixed epoch; held-out episodes never used for optimization or selection",
              "datasetSHA256": dataset_hash, "trainEpisodes": len(train), "trainTimestepsPerEpoch": train_timesteps}
    bundle: dict[str, Any] = {"schemaVersion": 1, "observationSize": 160, "mapShape": [16, 20, 20],
                              "mapChannelNames": source.get("mapChannelNames", []), "startedAt": started,
                              "config": config, "recurrenceSanity": sanity_memory, "models": []}
    summary: dict[str, Any] = {"schemaVersion": 1, "startedAt": started, "config": config, "recurrenceSanity": sanity_memory, "models": []}
    args.output.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"event": "dataset-loaded", "episodes": len(episodes), "trainEpisodes": len(train), "trainTimesteps": train_timesteps}), flush=True)
    for seed in args.seeds:
        shared_old, initialization_source = initial_old_state(source, seed)
        schedule = episode_schedule(train, args.epochs, args.batch_size, seed)
        for architecture in args.architectures:
            policy = initialize_policy(architecture, seed, shared_old)
            include_maps = architecture in ("map", "residual-map-gru")
            first_batch = make_batch([train[index] for index in schedule[0][0]], include_maps)
            sanity = sanity_check(policy, first_batch)
            with torch.no_grad():
                initialization_parity = None
                if architecture in ("map", "residual-map-gru"):
                    old = initialize_policy("mlp", seed, shared_old)
                    observations, maps, _, mask = first_batch
                    delta = float((old(observations, maps, mask) - policy(observations, maps, mask)).abs().max())
                    if delta != 0:
                        raise RuntimeError(f"Zero residual did not preserve initial old policy: {delta}")
                    initialization_parity = {"maxAbsoluteLogitDifferenceFromOldMLP": delta}
            optimizer = torch.optim.Adam(policy.parameters(), lr=args.learning_rate)
            history: list[dict[str, Any]] = []
            model_start = time.perf_counter()
            optimizer_updates = 0
            for epoch, batches in enumerate(schedule, start=1):
                policy.train()
                loss_sum = 0.0
                correct = 0
                count = 0
                for indices in batches:
                    observations, maps, actions, mask = make_batch([train[index] for index in indices], include_maps)
                    optimizer.zero_grad(set_to_none=True)
                    logits = policy(observations, maps, mask)
                    loss = F.cross_entropy(logits[mask], actions[mask])
                    if not torch.isfinite(loss):
                        raise RuntimeError(f"Non-finite loss: {architecture}/{seed}/{epoch}")
                    loss.backward()
                    # error_if_nonfinite checks every gradient during real training.
                    torch.nn.utils.clip_grad_norm_(policy.parameters(), 5.0, error_if_nonfinite=True)
                    optimizer.step()
                    valid_count = int(mask.sum())
                    loss_sum += float(loss.detach()) * valid_count
                    correct += int(((logits.detach().argmax(dim=-1) == actions) & mask).sum())
                    count += valid_count
                    optimizer_updates += 1
                if count != train_timesteps:
                    raise RuntimeError("Training epoch did not visit every training timestep exactly once")
                epoch_metrics = {"epoch": epoch, "loss": loss_sum / count, "accuracy": correct / count,
                                 "elapsedSeconds": time.perf_counter() - model_start}
                history.append(epoch_metrics)
                if epoch == 1 or epoch % 10 == 0 or epoch == args.epochs:
                    print(json.dumps({"event": "epoch", "architecture": architecture, "seed": seed, **epoch_metrics}), flush=True)
            training_seconds = time.perf_counter() - model_start
            metrics = {} if args.skip_evaluation else evaluate_teacher_forced(policy, episodes, args.batch_size)
            training = {"epochs": args.epochs, "optimizerUpdates": optimizer_updates,
                        "maskedTimestepsSeen": train_timesteps * args.epochs,
                        "durationSeconds": training_seconds, "sanity": sanity,
                        "initializationSource": initialization_source,
                        "initialOldPolicyParity": initialization_parity, "history": history,
                        "teacherForced": metrics}
            model_id = f"{architecture}-seed{seed}"
            metadata = {"id": model_id, "architecture": architecture, "seed": seed,
                        "parameterCount": EXPECTED_PARAMETERS[architecture], "training": training}
            bundle["models"].append({**metadata, "stateDict": export_state(policy), "parity": parity_cases(policy, episodes)})
            summary["models"].append(metadata)
            atomic_json(args.output / "models.json", bundle)
            atomic_json(args.output / "training-summary.json", summary)
            print(json.dumps({"event": "model-complete", "id": model_id, "durationSeconds": training_seconds, "teacherForced": metrics}), flush=True)
    finished = utc_now()
    for document in (bundle, summary):
        document["finishedAt"] = finished
        document["durationSeconds"] = time.perf_counter() - wall_start
    atomic_json(args.output / "models.json", bundle)
    atomic_json(args.output / "training-summary.json", summary)
    print(json.dumps({"event": "complete", "models": len(bundle["models"]), "durationSeconds": summary["durationSeconds"]}), flush=True)


if __name__ == "__main__":
    main()
