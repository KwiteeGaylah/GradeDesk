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

To publish the video, attach it to a GitHub release. To make it *play inline*
in the README, you need a URL on GitHub's own CDN: open a new issue on the
repository, drag the MP4 into the comment box, wait for the upload to finish,
and copy the `https://github.com/user-attachments/...` URL it generates. You do
not have to submit the issue. Then replace the poster image block in the main
[README](../../README.md#-walkthrough-video) with:

```html
<video src="PASTE_THE_URL_HERE" controls width="700"></video>
```

GitHub will not play a video from a repository path, which is why the README
currently shows a clickable poster image instead.

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
