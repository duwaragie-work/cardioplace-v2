import { Controller, Get, Post, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('v2/knowledgebase')
export class KnowledgebaseController {
    @Get()
    getAllKnowledgebase() {
        return {
            message: 'Knowledgebase router is healthy',
            data: []
        };
    }

    @Post('document/upload')
    @UseInterceptors(FileInterceptor('document'))
    uploadDocument(@UploadedFile() file: Express.Multer.File) {
        
        return {
            message: 'Document uploaded successfully',
            data: {
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
            }
        };
    }
}
