# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/endraputra9/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/endraputra9/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

BREACHLINE — a round-based tactical FPS built with three.js. Two five-player
teams fight over Foundry Nine, an original dusk foundry map with two charge
sites (the Smelter and the Casting Hall), three lanes and a full round
economy: earn for kills and round wins, buy from five original weapons plus
armour, a defuse kit and frag/smoke grenades, plant or defuse the Charge,
swap sides at half time, first to seven. Single-player against bot teammates
and opponents that path the map, hold sites, react to sight and gunfire, and
punish spraying — spread blooms on the move, so stopping to aim pays.
Static files only, no build step, no network: three.js 0.187.0 is vendored
in the repo, and every sound is synthesised with WebAudio.

## Run it

```sh
node serve.ts          # serves game/ at http://localhost:8080
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # build the entry output
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
