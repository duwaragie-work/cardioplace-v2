import { Controller, Get, Post, UseInterceptors, UploadedFile, HttpException, HttpStatus } from '@nestjs/common';
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
    async uploadDocument(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST);
        }

        try {
            const content = await this.knowledgebaseService.processDocument(file.buffer, file.originalname);
            
            return {
                message: 'Document uploaded and processed successfully',
                data: {
                    originalName: file.originalname,
                    mimeType: file.mimetype,
                    size: file.size,
                    content: content
                }
            };
        } catch (error) {
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
