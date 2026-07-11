<p align="center">
  <img src="MACN_poster.png" width="100%">
</p>

# MACN - Mesh Autonomous Compute Network

MACN is an experimental project exploring distributed computing across everyday devices.

Its goal is to enable PCs, smartphones, and tablets to collaborate in executing computationally intensive tasks such as AI workloads, rendering, video encoding, scientific simulations, and large-scale data processing.

## Core Idea

The device requesting computing power becomes the **Job Coordinator**.

Other available devices join the network as **Volunteer Workers**.

MACN is not designed as a centralized data center, but as a dynamic, distributed, and potentially peer-to-peer computing network.

## First Experiment

A first real-world experiment successfully connected **7 devices** simultaneously using WebRTC:

- 3 PCs
- 3 Smartphones
- 1 Tablet

The objective was to validate communication between heterogeneous devices within a distributed network.

## Potential Applications

- AI training and fine-tuning
- Distributed rendering
- Video encoding
- Scientific simulations
- Scientific computing
- Volunteer distributed computing

## Vision

MACN explores a distributed computing model inspired by the spirit of SETI@home, while adapting it to modern computing needs.

The idea is to leverage existing hardware instead of continuously building new dedicated data centers.

## Project Status

MACN is currently in the experimental research phase.

This repository documents the project's vision, experiments, prototypes, and future development.

## Experimental Milestone – ComputeRTC v0.5.2

**ComputeRTC v0.5.2** is an experimental compute-oriented transport layer built on top of standard WebRTC DataChannels. It does not replace WebRTC: it adds transport semantics tailored to distributed computation while keeping signaling and peer-to-peer connectivity on WebRTC.

The validated two-peer experiment completed a distributed Mandelbrot workload and centralized **40/40 unique task results** at the Job Coordinator. The run produced the expected `COMPLETED` and `JOB COMPLETE` messages.

This milestone includes:

- separate `CONTROL` and `DATA` DataChannels;
- four logical lanes for heartbeat, critical control, checkpoints, and task data;
- prioritized control traffic, bounded queues, and backpressure;
- cooperative work-stealing and duplicate-safe Help requests;
- workload updates approximately 30 ms after a change;
- centralized task-result collection and final `JOB_COMPLETE` broadcast.

The experiment is preserved as a separate continuation in [`macn-computertc-v0.5.2/`](macn-computertc-v0.5.2/).

### Replay the recorded browser demo

Open the [ComputeRTC recorded-session replay](https://onissum.github.io/MACN/macn-computertc-v0.5.2/demo.html) to reconstruct the real two-peer test from July 10, 2026: 40 tasks, initial 28/12 allocation, two work-stealing operations transferring four tasks to the Coordinator, final 32/8 processing split, centralized 40/40 collection, and the recorded 9.15-second completion time. The animation is accelerated; its final values match the recorded session. The standalone source is available in [`demo.html`](macn-computertc-v0.5.2/demo.html).

## Milestone 0 – Seven Device Test

MACN has already completed its first successful real-world prototype.

Seven devices were connected simultaneously through WebRTC:

- 3 PCs
- 3 Smartphones
- 1 Tablet

This experiment demonstrated the feasibility of establishing a distributed communication network across heterogeneous devices.

## Initial Roadmap

### v0.1 – Network Test

- Multi-device WebRTC communication
- Node discovery and identification
- Online/offline status management
- Cross-device compatibility testing

### v0.2 – Distributed Task Execution

- Distribution of small computational tasks
- Local execution by volunteer workers
- Result aggregation by the coordinator
- Performance measurement

### v0.3 – Distributed Benchmarking

- Workload partitioning across devices
- Contribution measurement for each node
- Handling slow or disconnected workers

### v0.4 – AI & Rendering Experiments

- AI micro-task execution
- Distributed rendering and video encoding
- Volunteer computing model evaluation

## Historic Prototype v11

During the early experimental phase, an advanced prototype of MACN was developed:

**MACN v11.0 – Asymmetric Distribution for Active Work-Stealing**

This prototype already included:

- Peer-to-peer WebRTC communication
- Distributed computational task execution
- Mandelbrot benchmark
- Real-time peer status monitoring
- Help-offer / Help-accept / Help-decline protocol
- Cooperative work-stealing
- Asymmetric workload distribution

The historical prototype is preserved in:

`historic-prototypes/v11/`
