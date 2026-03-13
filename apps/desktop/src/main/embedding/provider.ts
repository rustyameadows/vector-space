export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly version: string;
  embedText(input: string): Promise<number[]>;
  embedImage(buffer: Buffer): Promise<number[]>;
}

interface GeminiApiResponse {
  embedding?: {
    values?: number[];
  };
}

const assertEmbeddingValues = (payload: GeminiApiResponse): number[] => {
  const values = payload.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error('Gemini embedding response did not include embedding.values');
  }

  return values;
};

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'gemini';

  public readonly model: string;

  public readonly version = 'v1';

  private readonly apiKey: string;

  public constructor(config: { apiKey: string; model?: string }) {
    this.apiKey = config.apiKey.trim();
    this.model = config.model ?? 'gemini-embedding-001';
  }

  public async embedText(input: string): Promise<number[]> {
    return this.embedContent({ text: input });
  }

  public async embedImage(buffer: Buffer): Promise<number[]> {
    return this.embedContent({ inlineData: { mimeType: 'image/png', data: buffer.toString('base64') } });
  }

  private async embedContent(part: { text?: string; inlineData?: { mimeType: string; data: string } }): Promise<number[]> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`;
    const response = await fetch(`${endpoint}?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: {
          parts: [part]
        }
      })
    });

    if (!response.ok) {
      const reason = await response.text();
      throw new Error(`Gemini embedding request failed (${response.status}): ${reason}`);
    }

    const payload = (await response.json()) as GeminiApiResponse;
    return assertEmbeddingValues(payload);
  }
}
