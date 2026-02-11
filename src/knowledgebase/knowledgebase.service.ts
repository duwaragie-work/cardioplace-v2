import { Injectable } from '@nestjs/common';
import { extractTextFromBuffer } from './utils/document-reader.util';

@Injectable()
export class KnowledgebaseService {
  async processDocument(buffer: Buffer, originalName: string): Promise<string> {
    try {
      return await extractTextFromBuffer(buffer, originalName);
    } catch (error) {
      throw new Error(`Error processing document: ${error.message}`);
    }
  }
}
