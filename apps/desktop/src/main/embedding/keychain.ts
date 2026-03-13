import keytar from 'keytar';

const SERVICE_NAME = 'Vector Space';
const ACCOUNT_NAME = 'gemini-api-key';

export const getGeminiApiKeyFromKeychain = async (): Promise<string | null> => {
  return keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
};

export const setGeminiApiKeyInKeychain = async (apiKey: string): Promise<void> => {
  await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, apiKey.trim());
};

export const deleteGeminiApiKeyFromKeychain = async (): Promise<void> => {
  await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
};
