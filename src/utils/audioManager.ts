export type SoundName = 'bgm' | 'navigate' | 'colour' | 'vote';

const SOURCES: Record<SoundName, string> = {
  bgm: '/audio/___.mp3',
  navigate: '/audio/___.mp3',
  colour: '/audio/___.mp3',
  vote: '/audio/___.mp3',
};

class AudioManager {
  private sounds = new Map<SoundName, HTMLAudioElement>();
  private lastPlayed = new Map<SoundName, number>();

  preload() {
    if (typeof Audio === 'undefined') return;
    for (const [name, source] of Object.entries(SOURCES) as [SoundName, string][]) {
      if (this.sounds.has(name)) continue;
      const audio = new Audio(source);
      audio.preload = 'auto';
      audio.volume = name === 'bgm' ? 0.25 : 0.45;
      audio.loop = name === 'bgm';
      this.sounds.set(name, audio);
      audio.load();
    }
  }

  play(name: Exclude<SoundName, 'bgm'>) {
    this.preload();
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? 0) < 90) return;
    this.lastPlayed.set(name, now);
    const audio = this.sounds.get(name);
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }

  startHomeBgm() {
    this.preload();
    const bgm = this.sounds.get('bgm');
    if (bgm && bgm.paused) void bgm.play().catch(() => {});
  }

  stopHomeBgm() {
    const bgm = this.sounds.get('bgm');
    if (bgm) {
      bgm.pause();
      bgm.currentTime = 0;
    }
  }
}

export const audioManager = new AudioManager();