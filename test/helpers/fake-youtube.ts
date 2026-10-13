import type { CaptionCue } from "../../src/ingest/sources/vtt.js";
import type { CaptionTrack, PlayerCaptions } from "../../src/ingest/youtube/captions.js";
import type { YoutubeClient } from "../../src/ingest/youtube/client.js";

export const FIXTURE_VIDEO_ID = "abcdefghijk";
export const FIXTURE_VIDEO_B = "bcdefghijkl";
export const FIXTURE_VIDEO_NONE = "nolangtrack";

const LECTURE_CUES: CaptionCue[] = [
  {
    start_s: 0,
    end_s: 4.5,
    text: "Welcome to the automata theory lecture.",
  },
  {
    start_s: 4.5,
    end_s: 12,
    text: "Today we prove that a to the n b to the n is not regular using the pumping lemma.",
  },
  {
    start_s: 12,
    end_s: 20,
    text: "Assume for contradiction that the language is regular and let p be the pumping length.",
  },
  {
    start_s: 20,
    end_s: 28,
    text: "Choose the string w equal to a to the p b to the p, which is longer than p.",
  },
  {
    start_s: 65,
    end_s: 74,
    text: "Any split of w into xyz must place y entirely in the a block.",
  },
  {
    start_s: 74,
    end_s: 82,
    text: "Pumping down then yields fewer a symbols than b symbols, so the result is not in the language.",
  },
];

const DFA_CUES: CaptionCue[] = [
  { start_s: 0, end_s: 6, text: "A DFA has a finite set of states and a transition function." },
  { start_s: 6, end_s: 14, text: "Accept states decide which strings the machine recognizes." },
];

export function fakeYoutubeClient(overrides?: Partial<YoutubeClient>): YoutubeClient {
  const videos = new Map<string, PlayerCaptions>([
    [
      FIXTURE_VIDEO_ID,
      {
        videoId: FIXTURE_VIDEO_ID,
        title: "Lecture 1: Automata",
        duration_s: 3600,
        playability: "ok",
        tracks: [
          {
            baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en",
            languageCode: "en",
            name: "English",
          },
        ],
      },
    ],
    [
      FIXTURE_VIDEO_B,
      {
        videoId: FIXTURE_VIDEO_B,
        title: "Lecture 2: DFAs",
        duration_s: 2400,
        playability: "ok",
        tracks: [
          {
            baseUrl: "https://www.youtube.com/api/timedtext?v=bcdefghijkl&lang=en",
            languageCode: "en",
            kind: "asr",
            name: "English (auto-generated)",
          },
        ],
      },
    ],
    [
      FIXTURE_VIDEO_NONE,
      {
        videoId: FIXTURE_VIDEO_NONE,
        title: "Silent lecture",
        playability: "ok",
        tracks: [],
      },
    ],
  ]);

  const cues = new Map<string, CaptionCue[]>([
    [FIXTURE_VIDEO_ID, LECTURE_CUES],
    [FIXTURE_VIDEO_B, DFA_CUES],
  ]);

  return {
    async fetchVideo(videoId: string): Promise<PlayerCaptions> {
      const info = videos.get(videoId);
      if (info) {
        return info;
      }
      return {
        videoId,
        title: videoId,
        playability: "unavailable",
        playabilityReason: "unknown video",
        tracks: [],
      };
    },
    async fetchCaptionCues(track: CaptionTrack): Promise<CaptionCue[]> {
      const id = /[?&]v=([A-Za-z0-9_-]{11})/.exec(track.baseUrl)?.[1];
      return (id && cues.get(id)) || [];
    },
    async fetchPlaylist(): Promise<Array<{ videoId: string; title?: string }>> {
      return [
        { videoId: FIXTURE_VIDEO_ID, title: "Lecture 1: Automata" },
        { videoId: FIXTURE_VIDEO_B, title: "Lecture 2: DFAs" },
        { videoId: FIXTURE_VIDEO_NONE, title: "Silent lecture" },
      ];
    },
    async fetchOEmbedTitle(videoId: string): Promise<string | null> {
      return videos.get(videoId)?.title ?? null;
    },
    ...overrides,
  };
}
