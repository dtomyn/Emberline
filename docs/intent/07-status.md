# 7. Status and direction

As of 2026-11-05.

## Built

- Replay, Explore, Live and Story modes; fire detail cards
- Search: plain-language and faceted search, `/api/search`, CSV/GeoJSON export, shareable links
- True Spread Replay (Spread mode)
- Emberline Presents (▶ Watch): narrated film with Kokoro voice and a fire sound bed
- Lightning Storms (history and live)
- Hear the Season (sonified replay)
- Sources: Read the rings (every source, request, licence, live check)
- Living Terrain and Sky: 3D terrain and day/night lighting (smoke plumes not yet)
- Explainer film for YouTube, rendered by `npm run film`
- Security hardening (2026-11-05): escaping, CSP, loopback bind, Host check, SRI, throttling

## Unfinished or unverified

- Small-screen layout works but is unpolished.
- Pronunciation of place names in the film is unverified by ear beyond the known fixes.
- No configured SPSA active-fire layer yet; auto-discovery will find one when SPSA publishes it.

## Direction

The backlog and its suggested order are in [08-backlog.md](08-backlog.md). Next in line:
**Your Community's Fire Story**. Other candidates: smoke and fire-weather (FWI) overlays, season
and decade comparisons, shareable URL state for the other modes (Search already keeps its query
in the URL), and `live_snapshots` history playback.

Every new idea must meet the same bar as the built ones: striking *and* real, public data
loaded by a script, and anything simulated or illustrative labelled.
