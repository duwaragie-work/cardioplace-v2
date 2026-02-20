import { Test, TestingModule } from '@nestjs/testing'
import { KnowledgebaseController } from './knowledgebase.controller.js'

describe('KnowledgebaseController', () => {
  let controller: KnowledgebaseController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KnowledgebaseController],
    }).compile()

    controller = module.get<KnowledgebaseController>(KnowledgebaseController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })
})
