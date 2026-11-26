# Gotham — New York City as a strategy game

Every ~0.1 km² of New York City (7,857 H3 hexagons) rebuilt as a strategy-game map from 15+ real public datasets:
MapPLUTO (857k tax lots), 3.9M 311 requests, NYPD complaints and collisions, MTA hourly subway ridership, ACS 2020–24
by tract, the 2015 street tree census, restaurant inspections, parks, landmarks, cultural institutions, evictions, and live Citi Bike.

- 24 lenses (gold, production, food, cuisine, faith, wealth, rent, learning, science, diaspora, transit, noise by hour, rats…)
- 262 neighborhoods as "cities" with real districts (location quotients), citizens (occupations), commute mix
- 9 advisors that rank the city, an Explorer with a linked scatter + table, and rule-picked Wonders
- A 24-hour clock driven by real hourly subway ridership and 311 noise complaints

`pipeline/fetch.py` + `pipeline/fetch_daily.py` download the raw data; `pipeline/build.py` reconciles it onto the hex grid and writes
`web/public/data/*.json`. The app in `web/` is React + deck.gl + MapLibre.

Inspired by Andrej Karpathy's [usaciv](https://karpathy.ai/usaciv/). Built with Claude Code.
