export type GeminiTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface EmbedRequest {
  taskType: GeminiTaskType;
  textParts?: string[];
  imageBuffer?: Buffer;
  outputDimensionality?: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly preprocessingVersion: number;
  readonly extractionVersion: number;
  readonly ocrVersion: number;
  readonly outputDimensionality: number;
  embed(request: EmbedRequest): Promise<number[]>;
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

  public readonly preprocessingVersion: number;

  public readonly extractionVersion: number;

  public readonly ocrVersion: number;

  public readonly outputDimensionality: number;

  private readonly apiKey: string;

  public constructor(
    config: {
      apiKey: string;
      model?: string;
      preprocessingVersion?: number;
      extractionVersion?: number;
      ocrVersion?: number;
      outputDimensionality?: number;
    }
  ) {
    this.apiKey = config.apiKey.trim();
    this.model = config.model ?? 'gemini-embedding-001';
    this.preprocessingVersion = config.preprocessingVersion ?? 3;
    this.extractionVersion = config.extractionVersion ?? 2;
    this.ocrVersion = config.ocrVersion ?? 2;
    this.outputDimensionality = config.outputDimensionality ?? 3072;
  }

  public async embed(request: EmbedRequest): Promise<number[]> {
    if ((!request.textParts || request.textParts.length === 0) && !request.imageBuffer) {
      throw new Error('Embedding request requires textParts and/or imageBuffer');
    }

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    if (request.imageBuffer) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: request.imageBuffer.toString('base64')
        }
      });
    }

    for (const text of request.textParts ?? []) {
      const normalized = text.trim();
      if (normalized) {
        parts.push({ text: normalized });
      }
    }

    if (parts.length === 0) {
      throw new Error('Embedding request has no valid parts after normalization');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent`;
    const response = await fetch(`${endpoint}?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: `models/${this.model}`,
        taskType: request.taskType,
        outputDimensionality: request.outputDimensionality ?? this.outputDimensionality,
        content: {
          parts
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
