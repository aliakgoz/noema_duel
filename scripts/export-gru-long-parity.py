#!/usr/bin/env python3
"""Re-export frozen experimental weights with complete room-56 parity traces.

No optimizer, retraining, checkpoint selection, or source-artifact mutation.
The output directory can be checked by evaluate-gru-experiment.ts --parity-only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import torch


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("artifacts/gru-experiment/models.json"))
    parser.add_argument("--data", type=Path, default=Path("artifacts/gru-experiment/dataset.json"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/gru-experiment/long-parity"))
    args = parser.parse_args()
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    module_spec = importlib.util.spec_from_file_location("noema_gru_experiment", Path(__file__).with_name("train-gru-experiment.py"))
    assert module_spec is not None and module_spec.loader is not None
    trainer = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(trainer)
    source_bytes = args.source.read_bytes()
    bundle = json.loads(source_bytes)
    _, episodes, dataset_hash = trainer.load_dataset(args.data)
    if bundle["config"]["datasetSHA256"] != dataset_hash:
        raise ValueError("Frozen weights and dataset hashes differ")
    chosen = []
    for split in ("train", "test-start", "test-layout"):
        candidates = [episode for episode in episodes if episode["source"]["baseLevelId"] == "room-56" and episode["split"] == split]
        if not candidates:
            raise ValueError(f"Missing complete connected-room episode: {split}")
        chosen.append(max(candidates, key=lambda episode: len(episode["actions"])))
    for model in bundle["models"]:
        policy = trainer.Policy(model["architecture"])
        state_dict = {name: torch.tensor(value["values"], dtype=torch.float32).reshape(value["shape"])
                      for name, value in model["stateDict"].items()}
        policy.load_state_dict(state_dict, strict=True)
        policy.eval()
        model["parity"] = []
        with torch.no_grad():
            for episode in chosen:
                observations, maps, _, mask = trainer.make_batch([episode], model["architecture"] in ("map", "residual-map-gru"))
                logits = policy(observations, maps, mask)[0].tolist()
                model["parity"].append({"episodeId": episode["id"], "steps": [
                    {"observation": episode["source"]["observations"][step],
                     "mapSparse": episode["source"]["mapSparse"][step], "logits": values}
                    for step, values in enumerate(logits)
                ]})
        print(json.dumps({"id": model["id"], "traceLengths": [len(trace["steps"]) for trace in model["parity"]]}), flush=True)
    bundle["supplementaryParity"] = {
        "scope": "Whole connected-room expert observation sequences; numerical parity only, not new completion measurements",
        "sourceModelFileSHA256": hashlib.sha256(source_bytes).hexdigest(),
        "datasetSHA256": dataset_hash,
        "unchangedWeights": True,
    }
    trainer.atomic_json(args.output / "models.json", bundle)


if __name__ == "__main__":
    main()
