import { describe, expect, it } from 'vitest';
import {
  buildGeminiEmbeddingVersion,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_EMBEDDING_VERSION,
  getGeminiApiSettings
} from './gemini';

const expectedModel = ['gemini', 'embedding', '2', 'preview'].join('-');

describe('gemini model lock', () => {
  it('pins the embedding model to the approved preview release', () => {
    expect(GEMINI_EMBEDDING_MODEL).toBe(expectedModel);
  });

  it('returns renderer-visible api settings with the locked model', () => {
    expect(getGeminiApiSettings(true)).toEqual({
      hasApiKey: true,
      model: GEMINI_EMBEDDING_MODEL
    });
  });

  it('builds the canonical embedding version string from the locked model', () => {
    expect(buildGeminiEmbeddingVersion()).toBe(GEMINI_EMBEDDING_VERSION);
  });
});
