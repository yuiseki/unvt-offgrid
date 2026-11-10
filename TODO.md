# TODO

## iOS storage behaviour (unverified)

All browsers on iOS, including Chrome, are believed to run on WebKit, so
Safari's 7-day eviction of script-writable storage and its OPFS quota may
also apply to Chrome on iPhone. Nobody on the project has an iOS device to
check this. For now only Safari itself is warned (src/env.ts).

Options for deciding when to show a warning:

- A. Ask the browser at runtime: warn when `navigator.storage.persist()` is
  not granted or `navigator.storage.estimate()` reports too little quota.
  Same rule on every device.
- B. Warn on every iOS/iPadOS browser regardless of what the APIs report.
- C. Both: always warn on iOS, use the runtime checks elsewhere.

Undecided. Revisit when someone can test on a real iOS device.

## Not done yet

- Only one region is shown at a time. With two prefectures downloaded, the
  map of one does not show the other (it is drawn as sea).
- Picker cosmetics: the world backdrop is simplified hard (spiky coasts), and
  the simplified prefecture outlines overlap a little around Tokyo Bay.
- Updates: a new archive (new date in the file name) is a new file; nothing
  yet tells the user that a newer version exists or removes the old one.
- Build regions from the newer regional `.osm.pbf` (e.g. kanto-260906) with
  planetiler instead of cutting the 2025-11-24 planet archive.
- The result of `navigator.storage.persist()` is only logged to the console.
- Test on a real Android phone (so far only phone-sized headless Chromium).
