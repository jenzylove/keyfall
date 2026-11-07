# Simulation result

Season: 56 epochs of 6 hours, 10-minute steps, 5 seeds per scenario, 48 parameter sets tried.

Chosen: harvest 250 bps, raid take 1000 bps on exposed and 200 bps on vaults, no punching down below 1/4 of your size, boss 10 bps. Goal penalty 7.50 (0 = every goal met).

| Scenario | Satoshi left % | Never-migrated keep % | Small vault worst raid loss % | Small vault median raid loss % | Successful raids on vaults | Top 2 share % |
|---|---|---|---|---|---|---|
| base | 13.2 | 24.4 | 6.2 | 1.7 | 17 | 70.5 |
| bot_heavy | 16.5 | 24.2 | 0.0 | 0.0 | 10 | 61.1 |
| everyone_migrates_day_one | 19.4 | NaN | 7.1 | 0.0 | 5 | 97.7 |
| low_activity | 15.7 | 26.7 | 0.0 | 0.0 | 3 | 81.8 |
| sybil_heavy | 4.0 | 24.2 | 4.7 | 0.0 | 13 | 63.5 |
| whale_dominated | 19.0 | 24.9 | 3.8 | 0.0 | 5 | 95.9 |

The one goal not met is tension when everyone migrates on day one: successful raids on vaults are limited by how often simulated players choose to raid (an assumption), not by any rule number. The live season measures it for real.

Goals: Satoshi 5–30% left at Q-Day; never-migrated holders keep 10–40%; small vaults lose at most 25% to raids (median at most 5%) in every scenario; at least 20 successful raids on vaults when everyone migrates on day one.
