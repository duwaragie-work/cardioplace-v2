import { Test, TestingModule } from '@nestjs/testing'
import { KnowledgebaseService } from './knowledgebase.service.js'

describe('KnowledgebaseService', () => {
  let service: KnowledgebaseService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KnowledgebaseService],
    }).compile()

    service = module.get<KnowledgebaseService>(KnowledgebaseService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
