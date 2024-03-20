# Sort Youtube Playlist By Duration

Proper repository for Greasyfork plugin Sort Youtube Playlist By Duration (formerly Sort Youtube Watch Later by Duration)

## Contributing

Contributors welcome! There are edge cases I cannot handle quickly especially in non-Chromium engines.

My setup is ViolentMonkey on Chromium and Firefox. Volunteers are encouraged to bugtest on alternative platforms.

## Issues

### TamperMonkey 5.1.0, Chrome Canary 124

Something about TM and Chrome Canary is not compatible and may cause issue. Three solution to this:
1. Go to TM settings, change from Novice to Advanced, scroll down all the way to Experimental and **switch Inject mode to Instant**
2. Go to [Chrome Experiments](chrome://flags/), enable `Enable (deprecated) synchronous mutation events` and restart Chrome.
3. Reinstall Chrome completely, removing previous browsing data
