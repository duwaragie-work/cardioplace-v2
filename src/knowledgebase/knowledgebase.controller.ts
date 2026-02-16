import { Controller, Get, Post, UseInterceptors, UploadedFile, HttpException, HttpStatus, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgebaseService } from './knowledgebase.service';

@Controller('v2/knowledgebase')
export class KnowledgebaseController {
    constructor(private readonly knowledgebaseService: KnowledgebaseService) {}

    @Get()
    getAllKnowledgebase() {
        return {
            message: 'Knowledgebase router is healthy',
            data: []
        };
    }

    @Post('document/upload')
    @UseInterceptors(FileInterceptor('document'))
    async uploadDocument(
        @UploadedFile() file: Express.Multer.File,
        @Body() body: any,
    ) {
        if (!file) {
            throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
        }

        const existingDocument = await this.knowledgebaseService.findDocumentByName(file.originalname);
        if (existingDocument) {
            return {
                message: 'already uploaded',
                data: existingDocument
            };
        }

        try {
            const content = await this.knowledgebaseService.processDocument(file.buffer, file.originalname);
            
            let tags: string[] = [];
            if (body.tags) {
                try {
                    tags = typeof body.tags === 'string' ? JSON.parse(body.tags) : body.tags;
                } catch (e) {
                    console.error('Error parsing tags:', e);
                    tags = [];
                }
            }

            const savedDocument = await this.knowledgebaseService.saveDocument(file, content, {
                originalName: file.originalname,
                fileExtension: file.originalname.split('.').pop(),
                fileSize: file.size,
                sourceType: body.sourceType,
                sourceResourceLink: body.resouceLink, // Map resouceLink (sic) to sourceResourceLink
                sourceTags: tags,
            });
            
            return {
                message: 'Document uploaded and processed successfully',
                data: savedDocument
            };
        } catch (error) {
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
