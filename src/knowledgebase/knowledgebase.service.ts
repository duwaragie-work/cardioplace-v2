import { Injectable } from '@nestjs/common';
import { extractTextFromBuffer } from './utils/document-reader.util';
import { document_cleaner } from './utils/text-cleaner';
import { text_splitter } from './utils/text-splitter';
import { PrismaService } from '../prisma/prisma.service';
import { MistralService } from '../mistral/mistral.service';
import { retry } from '@mistralai/mistralai/lib/retries';

@Injectable()
export class KnowledgebaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mistralService: MistralService,
  ) {}

  async findDocumentByName(name: string) {
    return this.prisma.document.findFirst({
      where: {
        sourceName: name,
      },
    });
  }

  async processDocument(buffer: Buffer, originalName: string): Promise<string[]> {
    try {
      const text = await extractTextFromBuffer(buffer, originalName);
      const cleand_text = document_cleaner(text);
      const split_text = text_splitter(cleand_text);
      return split_text;
    } catch (error) {
      throw new Error(`Error processing document: ${error.message}`);
    }
  }

  async getAllDocuments(){
    return this.prisma.document.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async accessSingleDocument(id:string) {
    const existingDocument = await this.prisma.document.findUnique({ where: { id } });
  
    if (!existingDocument) {
      return {status: false, message: "Document not found"};
    }

    return {status: true, data: existingDocument};
  }

  async updateDocumentTags(id: string, tags: string[]){

    return this.prisma.document.update({
      where: {
        id: id,
      },
      data: {
        sourceTags: tags,
      },
    });
  }
  
  async updateDocumentStatus(id: string, status: boolean) {

    await this.prisma.$executeRaw`
      UPDATE "DocumentVector"
      SET "sourceActiveStatus" = ${status}
      WHERE "documentId" = ${id}
    `;

    return this.prisma.document.update({
      where: {
        id: id,
      },
      data: {
        sourceActiveStatus: status,
      },
    });
  }

  async saveDocument(
    file: Express.Multer.File,
    chunks: string[],
    metadata: any,
  ) {
    try {
      const {
        originalName,
        fileExtension,
        fileSize,
        sourceType,
        sourceResourceLink,
        sourceTags, // Destructure sourceTags
      } = metadata;

      // 1. Create Document Record
      const document = await this.prisma.document.create({
        data: {
          sourceName: originalName,
          sourceType: sourceType || 'file',
          sourceFormat: fileExtension,
          sourceSize: fileSize,
          sourceChunkCount: chunks.length,
          sourceResourceLink: sourceResourceLink || '',
          sourceTags: sourceTags || [], // Use passed tags or default to empty
          sourceActiveStatus: true,
        },
      });

      // 2. Generate Embeddings and Save Vectors
      for (const chunk of chunks) {
        const embeddingResponse = await this.mistralService.getEmbeddings(chunk);
        const embedding = embeddingResponse.data[0]?.embedding;

        if (!embedding) {
          console.warn(`Failed to generate embedding for chunk: ${chunk.substring(0, 50)}...`);
          continue;
        }

        // format embedding as a string for vector pgvector insertion: "[0.1, 0.2, ...]"
        const embeddingString = `[${embedding.join(',')}]`;

        await this.prisma.$executeRaw`
            INSERT INTO "DocumentVector" ("id", "content", "embedding", "documentId", "sourceActiveStatus")
            VALUES (gen_random_uuid(), ${chunk}, ${embeddingString}::vector, ${document.id}, true)
        `;
      }

      return document;
    } catch (error) {
      throw new Error(`Error saving document: ${error.message}`);
    }
  }
}
