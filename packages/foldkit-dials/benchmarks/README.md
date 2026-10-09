# Timeline evaluation benchmark

Host sampling resolves the edited timeline once and uses its duration for
continuous cycle time and its clips for sampling. Resolution is local to each
call. Editing, restored Model snapshots and separate dock instances read their
current timeline without an identity cache or derived Model state.

Run from the workspace root after a frozen install:

```sh
BENCHMARK_OUTPUT=/tmp/timeline-result.json node_modules/.bin/vitest run --config tooling/timeline-benchmark.config.ts
```

The dedicated config runs only this benchmark, outside the normal test suite
and library build. On the shared Mini, acquire `/tmp/fkd-heavy-jobs.lock` with
Python `fcntl.flock` before running it, as for the repository check.

## Method

Measurements use the M1 Mini, macOS arm64, Node 22.23.2 and Vitest 5.0.3 with
happy-dom. Each stage warms for 100 ms, then runs nine batches of at least
100 ms. Reported times are the median batch mean in microseconds per call;
the JSON output also contains the minimum and maximum batch means. Fixture
construction, Model setup, Scene setup and assertions are outside the timed
operations. Garbage collection is not forced. Stages run sequentially under
the shared heavy-job lock.

Each group has an easing tween, a three-step looping sequence, three property
tracks (two sequences, one delayed, and a delayed physics spring), and a looping
physics tween. Each timeline also has an ungrouped intro tween and a marker.
The timeline duration is six seconds. Sampling uses playhead time 1.5, two
wraps and a region loop from one second. The dock is open, its ruler is 1,000
pixels wide and its property rows are collapsed.

| Fixture | Clips | Groups | Tracks | Steps | Physics spans |
| ------- | ----: | -----: | -----: | ----: | ------------: |
| Small   |    10 |      2 |     13 |    21 |             4 |
| Medium  |    82 |     20 |    121 |   201 |            40 |
| Large   |   402 |    100 |    601 |  1001 |           200 |

`resolve` measures static shape construction. `sampleResolved` samples an
already resolved timeline without grouping the results. `valuesAt` includes
one resolution, sampling and nesting by group. The standalone and typed
`valuesOf` stages use the host APIs, including continuous cycle time.
`tick` is one playing `TickedFrame` update with a 16 ms delta. `dockView` builds
the view tree, including its resolution. `dockViewResolved` substitutes the
resolved fixture through a Vitest spy to estimate view construction separately;
it includes spy overhead. `evaluation` performs a tick, typed host sampling
and dock view construction from the resulting Model.

These are source-level CPU measurements. They do not include browser DOM
reconciliation, layout, paint, subscriptions or MessageChannel pacing, and
do not demonstrate a browser frame-rate problem. The 402-clip fixture is a
stress case, not a claim about a typical demo.

## Results

Baseline source: `ba86f384f60a09d61312b66301eb2d18a43ed861`.
The comparison changes only per-call resolution sharing in host sampling.
Raw baseline/change JSON is attached to the task and pull request evidence.

| Stage (µs/call)              | Small baseline / change | Medium baseline / change | Large baseline / change |
| ---------------------------- | ----------------------: | -----------------------: | ----------------------: |
| Static resolution            |             16.4 / 16.5 |            148.5 / 150.7 |           831.3 / 749.7 |
| Resolved sampling            |             66.4 / 66.4 |            618.7 / 608.6 |         3355.5 / 3111.2 |
| Timeline.valuesAt            |             85.7 / 83.1 |            821.7 / 849.5 |         4971.0 / 4523.0 |
| Standalone valuesOf          |             99.4 / 87.2 |            949.9 / 849.1 |         5772.1 / 4798.1 |
| Typed valuesOf               |             99.0 / 83.1 |            945.1 / 811.2 |         5390.9 / 4833.9 |
| Playback tick                |             18.3 / 18.4 |            148.9 / 148.4 |           756.3 / 792.3 |
| Dock view construction       |           558.7 / 514.1 |          3365.1 / 3489.6 |       17807.7 / 17986.8 |
| Tick + typed sampling + view |           678.2 / 658.0 |          4510.8 / 4346.1 |       24816.8 / 23587.3 |
| View with resolved statics   |           515.0 / 480.5 |          3221.1 / 3127.0 |       16948.7 / 16313.5 |

Typed host sampling drops by 16%, 14% and 10% for these fixtures. Standalone
sampling drops by 12%, 11% and 17%. The unchanged controls also vary between
runs, especially for the stress fixture, so the full-evaluation differences
are not reliable frame-rate evidence. Small host calls save about 12–16 µs.

The comparison run also times the original two-resolution expression as a
same-process control (`valuesOfSeparateResolution`):

| Fixture | Two-resolution control (µs) | Typed host call (µs) | Difference |
| ------- | --------------------------: | -------------------: | ---------: |
| Small   |                        98.9 |                 83.1 |       −16% |
| Medium  |                      1009.3 |                811.2 |       −20% |
| Large   |                      5267.0 |               4833.9 |        −8% |

This control supports removing duplicate host resolution. It does not support
adding an identity cache: update, sampling and rendering continue to resolve
independently, and view construction dominates these open-dock fixtures.

## Equivalence and scope

The benchmark hashes complete sampled values at eleven playhead times and
three wrap counts per fixture, including before-start, sequence boundaries
and after-end states. Regression tests compare both host APIs with explicit
timeline duration and cycle time through grouped sequences, delayed physics
tracks, whole/region/fallback loops, spring edits that extend the duration,
sequence/track timing edits, restored snapshots and interleaved instances.
All three baseline/change SHA-256 digests match exactly. The edited-spring
test fails when cycle time uses the authored minimum duration instead of the
effective duration, and passes after restoring the resolved duration.

Playback update and dock view construction each resolve once independently.
Group nesting retains its ordering and repeated filtering behavior. Cross-call
identity memoization and group indexing would add separate lifetime or
ordering concerns; the measured duplicate host resolution supports the local
reuse change without either. Numerical math and frame pacing are unchanged.
