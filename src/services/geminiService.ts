export async function processPage(imageDataUrl: string) {
  try {
    const response = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        originalText: errorData.originalText || `Error: ${response.status}`,
        englishTranslation: errorData.englishTranslation || `Error: ${response.status}`,
      };
    }

    return await response.json();
  } catch (error: any) {
    console.error('Error processing page:', error);
    return {
      originalText: `An error occurred: ${error.message || 'Unknown error'}`,
      englishTranslation: `An error occurred: ${error.message || 'Unknown error'}`,
    };
  }
}
