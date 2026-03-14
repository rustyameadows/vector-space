export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2-preview' as const;

export const GEMINI_PREPROCESSING_VERSION = 3;

export const GEMINI_EXTRACTION_VERSION = 2;

export const GEMINI_OCR_VERSION = 2;

export const GEMINI_OUTPUT_DIMENSIONALITY = 3072;

export const GEMINI_EMBEDDING_VERSION_SUFFIX = `p${GEMINI_PREPROCESSING_VERSION}-e${GEMINI_EXTRACTION_VERSION}-o${GEMINI_OCR_VERSION}` as const;

export const GEMINI_EMBEDDING_VERSION = `${GEMINI_EMBEDDING_MODEL}/${GEMINI_EMBEDDING_VERSION_SUFFIX}` as const;

export interface GeminiApiSettings {
  hasApiKey: boolean;
  model: typeof GEMINI_EMBEDDING_MODEL;
}

export const buildGeminiEmbeddingVersion = (params?: {
  model?: string;
  preprocessingVersion?: number;
  extractionVersion?: number;
  ocrVersion?: number;
}): string => {
  const model = params?.model ?? GEMINI_EMBEDDING_MODEL;
  const preprocessingVersion = params?.preprocessingVersion ?? GEMINI_PREPROCESSING_VERSION;
  const extractionVersion = params?.extractionVersion ?? GEMINI_EXTRACTION_VERSION;
  const ocrVersion = params?.ocrVersion ?? GEMINI_OCR_VERSION;

  return `${model}/p${preprocessingVersion}-e${extractionVersion}-o${ocrVersion}`;
};

export const getGeminiApiSettings = (hasApiKey: boolean): GeminiApiSettings => ({
  hasApiKey,
  model: GEMINI_EMBEDDING_MODEL
});
