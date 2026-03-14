import { describe, expect, it } from 'vitest';
import { GEMINI_EMBEDDING_MODEL } from '../../shared/gemini';
import { GeminiEmbeddingProvider } from './provider';

describe('GeminiEmbeddingProvider', () => {
  it('always exposes the locked embedding model', () => {
    const provider = new GeminiEmbeddingProvider({ apiKey: 'demo-key' });

    expect(provider.model).toBe(GEMINI_EMBEDDING_MODEL);
  });
});
