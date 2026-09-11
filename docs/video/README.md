# Video kit

The instructor walkthrough, and the files behind it.

## The finished video

**GradeDesk-walkthrough-captioned.mp4** — 5m 44s, 1366×768, 23 MB, burnt-in
captions. This is the one to hand out.

There is also `GradeDesk-walkthrough-narrated.mp4` (same video, no captions)
and `GradeDesk-walkthrough.srt` if you want captions as a separate file.

### These files are not in the repository

The video is 23 MB and its working files are another 84 MB, against a git
history of 2 MB. They are listed in `.gitignore` and live only on the machine
that made them, so **keep your own copy** — a fresh clone will not have them.

To publish the video, attach it to a GitHub release. The main README does not
link to it: GitHub will not play a video from a repository path, and a link to
an asset that may not exist yet is worse than no link at all. Add one to the
release notes instead, where the file actually lives.

If you ever do want it playing inline somewhere on GitHub, you need a URL on
GitHub's own CDN: open a new issue, drag the MP4 into the comment box, wait for
the upload to finish, and copy the `https://github.com/user-attachments/...`
URL it generates. You do not have to submit the issue. That URL works in any
Markdown on GitHub, inside a `<video src="..." controls></video>` tag.

## The source files

| File | What it is |
|---|---|
| [NARRATION.md](NARRATION.md) | The narration as recorded, split by scene. |
| [GradeDesk-walkthrough.srt](GradeDesk-walkthrough.srt) | Caption timings, already burnt into the captioned cut. |
| [SCRIPT.md](SCRIPT.md) | The original timed script: nine scenes, what is on screen, narration word for word, and a table of facts the video must not get wrong. |
| [AI_VIDEO_PROMPT.md](AI_VIDEO_PROMPT.md) | The brief for an AI video tool, if you ever remake it. |
| `source/` | Screen recordings, the voiceover MP3, and the intermediate cuts. Untracked. |

## Remaking or editing it

The narration is in `NARRATION.md` and the timings in the `.srt`. If you change
a line of narration, change the caption timing to match, or the burnt-in
captions will drift out of sync with the voice.

Before publishing a new cut:

- Check the narration against the facts table at the end of `SCRIPT.md`. The
  rules that get garbled are blank assessments counting as 50, a blank exam
  forcing an I, and the accuracy claim being one checked semester and nothing
  stronger.
- Watch it once with the sound off, reading only the captions.
- Confirm no real student names appear. Every name in the screenshots is
  invented and should stay that way.
