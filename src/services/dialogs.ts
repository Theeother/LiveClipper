import { open } from "@tauri-apps/plugin-dialog";

const VIDEO_EXTENSIONS = ["mkv", "mp4", "mov", "flv", "ts", "m4v", "webm"];

async function pickOne(options: Parameters<typeof open>[0]): Promise<string | null> {
  const picked = await open({ multiple: false, ...options });
  return typeof picked === "string" ? picked : null;
}

export const pickRecording = () =>
  pickOne({ title: "Select recording", filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }] });

export const pickPng = () => pickOne({ title: "Select watermark image", filters: [{ name: "PNG image", extensions: ["png"] }] });

export const pickFolder = (title: string) => pickOne({ title, directory: true });

export const pickExecutable = () => pickOne({ title: "Select ffmpeg.exe", filters: [{ name: "ffmpeg", extensions: ["exe"] }] });
