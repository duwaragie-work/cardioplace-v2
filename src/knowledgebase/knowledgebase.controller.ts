import {
  Body,
  Param,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { KnowledgebaseService } from './knowledgebase.service.js'

@Controller('v2/knowledgebase')
export class KnowledgebaseController {
  constructor(private readonly knowledgebaseService: KnowledgebaseService) {}

  @Get()
  getAllKnowledgebase() {
    return {
      message: 'Knowledgebase router is healthy',
      data: [],
    }
  }

  @Get('document')
  async getAllDocuments() {
    const documents = await this.knowledgebaseService.getAllDocuments()
    return {
      message: 'All documents fetched successfully',
      data: documents,
    }
  }

  @Patch('document/:id')
  async updateDocument(
    @Param('id') id: string,
    @Body() body: any
  ) {

    const hastTags = body.tags !== undefined
    const hastStatus = body.status !== undefined

    if(hastTags && hastStatus){
      try{
        const document = await this.knowledgebaseService.accessSingleDocument(
          id,
        )
        if (!document.status) {
          throw new HttpException('Document is not found', HttpStatus.NOT_FOUND)
        }

        const updatedDocumentTags = await this.knowledgebaseService.updateDocumentTags(id, body.tags)
        const updatedDocumentStatus = await this.knowledgebaseService.updateDocumentStatus(id, body.status)
        return {
          message: 'Document tag and status updated successfully',
          data: updatedDocumentStatus
        }

      } catch(e) {
        throw new HttpException("Something went wrong", HttpStatus.INTERNAL_SERVER_ERROR)
      }
    }
    else if(hastTags){
      try {
        const document = await this.knowledgebaseService.accessSingleDocument(
          id,
        )
        if (!document.status) {
          throw new HttpException('Document is not found', HttpStatus.NOT_FOUND)
        }
  
        const updatedDocument = await this.knowledgebaseService.updateDocumentTags(id, body.tags)
        return {
          message: 'Document tag updated successfully',
          data: updatedDocument,
        }
      } catch (error) {
        throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR)
      }
    }
    else if(hastStatus){
      try {
        const document = await this.knowledgebaseService.accessSingleDocument(
          id,
        )
    
        if (!document) {
          throw new HttpException('Document is not found', HttpStatus.NOT_FOUND)
        }
        const updatedDocument =
          await this.knowledgebaseService.updateDocumentStatus(
            id,
            body.status,
          )
        return {
          message: 'Document status updated successfully',
          data: updatedDocument,
        }
      } catch (error) {
        throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR)
      }
    }
  }

  @Post('document')
  @UseInterceptors(FileInterceptor('document'))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    if (!file) {
      throw new HttpException('No file uploaded', HttpStatus.BAD_REQUEST)
    }

    const existingDocument = await this.knowledgebaseService.findDocumentByName(
      file.originalname,
    )
    if (existingDocument) {
      return {
        message: 'already uploaded',
        data: existingDocument,
      }
    }

    try {
      const content = await this.knowledgebaseService.processDocument(
        file.buffer,
        file.originalname,
      )

      let tags: string[] = []
      if (body.tags && body.tags.length > 0) {
        try {
          tags =
            typeof body.tags === 'string' ? JSON.parse(body.tags) : body.tags
        } catch (e) {
          console.error('Error parsing tags:', e)
          tags = []
        }
      }

      const savedDocument = await this.knowledgebaseService.saveDocument(
        file,
        content,
        {
          originalName: file.originalname,
          fileExtension: file.originalname.split('.').pop(),
          fileSize: file.size,
          sourceType: body.sourceType,
          sourceResourceLink: body.resouceLink,
          sourceTags: tags,
        },
      )

      return {
        message: 'Document uploaded and processed successfully',
        data: savedDocument,
      }
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR)
    }
  }
}
