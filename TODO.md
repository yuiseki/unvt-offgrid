# TODO

## iOS storage behaviour (unverified)

All browsers on iOS, including Chrome, are believed to run on WebKit, so
Safari's 7-day eviction of script-writable storage and its OPFS quota may
also apply to Chrome on iPhone. Nobody on the project has an iOS device to
check this.

Options for deciding when to show a warning:

- A. Ask the browser at runtime: warn when `navigator.storage.persist()` is
  not granted or `navigator.storage.estimate()` reports too little quota.
  Same rule on every device.
- B. Warn on every iOS/iPadOS browser regardless of what the APIs report.
- C. Both: always warn on iOS, use the runtime checks elsewhere.

Undecided. Revisit when someone can test on a real iOS device.
