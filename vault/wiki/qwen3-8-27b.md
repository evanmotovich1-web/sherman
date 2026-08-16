# Qwen3.8-27B

The strongest dense, locally-deployable multimodal model in the ~30B class at
its launch, and the leading candidate for Sherman's local-model lane.

- **What:** Qwen3.8-27B, from Alibaba's Qwen team. Weights on Hugging Face
  2026-08-13; launch 2026-08-14 15:00 UTC.
- **Size:** 27.78B parameters, dense (not MoE) — 64 layers, hidden 5120,
  vocab 248,320 ("28B class").
- **License:** Apache 2.0.
- **Modality:** native text + image + video.
- **Context:** 262,144 native; extensible to 1M via YaRN (Qwen warns static
  YaRN can hurt shorter prompts).
- **Attention:** hybrid — 3 Gated DeltaNet layers per 1 full-attention layer.
- **Architecture tag:** `qwen3_5` (new GGUF arch) — needs a current llama.cpp
  build; pre-release builds refuse to load it.

## Benchmark deltas (Qwen-reported, vs Qwen3.6-27B)

| Benchmark | 3.6-27B | 3.8-27B |
| --- | --- | --- |
| Terminal-Bench 2.1 | 63.4 | 73.0 |
| DeepSWE 1.1 | 13.3 | 42.2 |
| OSWorld-Verified | 63.9 | 84.3 |
| SWE-MM | 25.7 | 38.6 |

Caveats: every launch score is vendor-reported; several benchmarks are
in-house or modified, and no independent reproduction existed on launch day.
The SWE-bench Pro comparison imports an Anthropic result rather than rerunning
it under Qwen's own setup.

## Running locally

- BF16 ≈ 55.6 GB; an FP8 artifact is published.
- GGUF: Q4_K_M ≈ 17.1 GB; IQ2 ≈ 9.0 GB. 24 GB cards fit Q4_K_M comfortably;
  12 GB cards need the smaller quants.
- Gotcha: some third-party GGUFs ship a broken/mismatched chat template —
  verify the template before judging output quality.

## Verdict

Best-in-class dense ~30B local model at launch, and the strongest case yet for
a local coding/agent/vision lane. It is not a replacement for frontier cloud
APIs, and not Qwen3.8-Max (a 2.4T-parameter data-center model under a separate,
non-Apache license). Treat as the new baseline candidate for Sherman's local
evaluation — see [[local-model-evaluation-2026-08-14]] — not as a completed
adoption decision.

Sources: kingy.ai launch review
(https://kingy.ai/blog/qwen3-8-27b-specs-benchmarks-local-hardware/);
locallyuncensored.com run guide
(https://locallyuncensored.com/blog/how-to-run-qwen-3-8-27b-locally.html);
Qwen3.8-27B-FP8 model card (https://huggingface.co/Qwen/Qwen3.8-27B-FP8);
orcarouter.ai GGUF guide (https://www.orcarouter.ai/blog/qwen-3-8-27b-gguf).
