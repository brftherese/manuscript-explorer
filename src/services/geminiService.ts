import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function processPage(imageDataUrl: string) {
  const base64Data = imageDataUrl.split(',')[1];
  const mimeType = imageDataUrl.split(';')[0].split(':')[1];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            text: 'Extract the original text (likely Latin) from this page, and provide an English translation of it. Return the result as JSON with "originalText" and "englishTranslation" fields. If the page is blank or contains no text, return empty strings.',
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            originalText: {
              type: Type.STRING,
              description: 'The extracted original text from the page.',
            },
            englishTranslation: {
              type: Type.STRING,
              description: 'The English translation of the extracted text.',
            },
          },
          required: ['originalText', 'englishTranslation'],
        },
      },
    });

    const jsonStr = response.text?.trim() || '{}';
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse JSON response', e);
      return { originalText: 'Error extracting text.', englishTranslation: 'Error translating text.' };
    }
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED') || error?.status === 'RESOURCE_EXHAUSTED') {
      return {
        originalText: 'API Rate Limit Exceeded (429).\n\nYou have exceeded your current quota for the Gemini API. Please wait a moment and try again, or check your billing details.',
        englishTranslation: 'API Rate Limit Exceeded (429).\n\nYou have exceeded your current quota for the Gemini API. Please wait a moment and try again, or check your billing details.'
      };
    }
    return {
      originalText: `An error occurred while processing the page: ${error.message || 'Unknown error'}`,
      englishTranslation: `An error occurred while processing the page: ${error.message || 'Unknown error'}`
    };
  }
}
