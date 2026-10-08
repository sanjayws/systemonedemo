import { LIMITS, modelRequestBytes, validateModelSize } from './schema.js';

export function imageBudgets(sizes, totalBytes) {
  const budgets = Array(sizes.length);
  const ordered = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size);
  for (const [position, { size, index }] of ordered.entries()) {
    const budget = Math.min(size, Math.floor(totalBytes / (sizes.length - position)));
    budgets[index] = budget;
    totalBytes -= budget;
  }
  return budgets;
}

export function imageDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file, maxBytes, signal) {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  try {
    let width = bitmap.width, height = bitmap.height;
    for (let attempt = 0; attempt < 12; attempt++) {
      signal.throwIfAborted();
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not prepare the image. Try a smaller JPEG.');
      // Give transparent images a predictable background and normalize orientation/metadata.
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      let blob;
      for (const quality of [0.88, 0.72, 0.6]) {
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        signal.throwIfAborted();
        if (!blob) throw new Error('This browser could not prepare the image. Try a smaller JPEG.');
        if (blob.size <= maxBytes) return await imageDataUrl(blob);
      }
      const scale = Math.min(0.8, Math.sqrt(maxBytes / blob.size) * 0.9);
      width = Math.max(1, Math.floor(width * scale)); height = Math.max(1, Math.floor(height * scale));
    }
    throw new Error('The image could not fit the model limit. Crop it to the relevant area or use fewer images.');
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}

export async function prepareImages(attachments, input, signal) {
  signal.throwIfAborted();
  if (modelRequestBytes(input) <= LIMITS.modelBodyBytes) return attachments;
  if (!attachments.length) { validateModelSize(input); return attachments; }
  const remaining = LIMITS.modelBodyBytes - modelRequestBytes({ ...input, images: [] }) - 64 * attachments.length;
  const imageBytes = Math.floor(remaining / 4) * 3;
  if (imageBytes < 8192 * attachments.length) throw new Error('The source and questions leave too little room for images. Shorten them or use fewer images.');
  const budgets = imageBudgets(attachments.map(image => image.file.size), imageBytes);
  const prepared = [];
  for (const [index, image] of attachments.entries()) {
    signal.throwIfAborted();
    // Always encode from the original file, never from an already compressed preview.
    const optimized = image.file.size > budgets[index];
    const dataUrl = optimized ? await compressImage(image.file, budgets[index], signal) : await imageDataUrl(image.file);
    prepared.push({ ...image, dataUrl, optimized });
  }
  signal.throwIfAborted();
  validateModelSize({ ...input, images: prepared.map(image => image.dataUrl) });
  return prepared;
}
