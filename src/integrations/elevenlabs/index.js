const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const API_BASE_URL = "https://api.elevenlabs.io/v1";

function toSha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function trimTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

class ElevenLabsTts {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.voiceId = options.voiceId;
    this.modelId = options.modelId || DEFAULT_MODEL_ID;
    this.outputFormat = options.outputFormat || DEFAULT_OUTPUT_FORMAT;
    this.publicBaseUrl = trimTrailingSlash(options.publicBaseUrl);
    this.cacheDir = path.resolve(options.cacheDir || ".cache/elevenlabs");
    this.enabled = Boolean(this.apiKey && this.voiceId && this.publicBaseUrl);
    this.promptByKey = new Map();
    this.keyByPrompt = new Map();
    this.audioByKey = new Map();
    this.inflightByKey = new Map();
  }

  registerPrompt(text) {
    const prompt = String(text || "").trim();
    if (!prompt || !this.enabled) {
      return null;
    }

    const key = toSha1(`${this.voiceId}:${this.modelId}:${this.outputFormat}:${prompt}`);
    this.promptByKey.set(key, prompt);
    this.keyByPrompt.set(prompt, key);
    return `${this.publicBaseUrl}/twilio/voice/audio/${key}.mp3`;
  }

  async getAudioByKey(key) {
    if (!this.enabled) {
      return null;
    }

    const prompt = this.promptByKey.get(key);
    if (!prompt) {
      return null;
    }

    const cachedAudio = this.audioByKey.get(key);
    if (cachedAudio) {
      return cachedAudio;
    }

    const filePath = this.getAudioFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const fromDisk = await fs.promises.readFile(filePath);
    this.audioByKey.set(key, fromDisk);
    return fromDisk;
  }

  async preGeneratePrompts(prompts) {
    if (!this.enabled) {
      return new Map();
    }

    await fs.promises.mkdir(this.cacheDir, { recursive: true });
    const audioUrlByPrompt = new Map();

    for (const prompt of prompts) {
      const text = String(prompt || "").trim();
      if (!text) {
        continue;
      }

      const audioUrl = this.registerPrompt(text);
      const key = this.keyByPrompt.get(text);
      await this.generateAndPersistAudioByKey(key, text);
      audioUrlByPrompt.set(text, audioUrl);
    }

    return audioUrlByPrompt;
  }

  getAudioFilePath(key) {
    return path.join(this.cacheDir, `${key}.mp3`);
  }

  async generateAndPersistAudioByKey(key, prompt) {
    if (this.audioByKey.has(key)) {
      return this.audioByKey.get(key);
    }

    const filePath = this.getAudioFilePath(key);
    if (fs.existsSync(filePath)) {
      const fromDisk = await fs.promises.readFile(filePath);
      this.audioByKey.set(key, fromDisk);
      return fromDisk;
    }

    const pendingAudio = this.inflightByKey.get(key);
    if (pendingAudio) {
      return pendingAudio;
    }

    const fetchPromise = this.generateAudio(prompt)
      .then(async (audioBuffer) => {
        await fs.promises.writeFile(filePath, audioBuffer);
        this.audioByKey.set(key, audioBuffer);
        this.inflightByKey.delete(key);
        return audioBuffer;
      })
      .catch((error) => {
        this.inflightByKey.delete(key);
        throw error;
      });

    this.inflightByKey.set(key, fetchPromise);
    return fetchPromise;
  }

  async generateAudio(prompt) {
    const query = new URLSearchParams({ output_format: this.outputFormat });
    const response = await fetch(
      `${API_BASE_URL}/text-to-speech/${encodeURIComponent(this.voiceId)}?${query.toString()}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text: prompt,
          model_id: this.modelId
        })
      }
    );

    if (!response.ok) {
      const details = (await response.text()).slice(0, 200);
      throw new Error(`ElevenLabs request failed with ${response.status}: ${details}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

function createElevenLabsTts(config) {
  return new ElevenLabsTts({
    apiKey: config.elevenLabs.apiKey,
    voiceId: config.elevenLabs.voiceId,
    modelId: config.elevenLabs.modelId,
    outputFormat: config.elevenLabs.outputFormat,
    cacheDir: config.elevenLabs.cacheDir,
    publicBaseUrl: config.urls.publicBase
  });
}

module.exports = {
  createElevenLabsTts,
  ElevenLabsTts
};
