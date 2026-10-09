// Runs LASER off the main thread so the board stays responsive while it simulates.
import { laserRank } from './laser.js';

self.onmessage = ({ data }) => {
  try {
    const results = laserRank({ ...data, onProgress: p => self.postMessage({ progress: p }) });
    self.postMessage({ results });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
