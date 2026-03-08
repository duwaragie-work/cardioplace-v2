import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'

describe('ChatController (e2e)', () => {
    let app: INestApplication

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile()

        app = moduleFixture.createNestApplication()
        await app.init()
    })

    afterAll(async () => {
        await app.close()
    })

    it('/chat/structured (POST) - with new sessionId', async () => {
        const response = await request(app.getHttpServer())
            .post('/chat/structured')
            .send({
                prompt: 'Hello, what is cognitive behavioral therapy?',
                date: new Date().toISOString(),
                medicalLens: 'Psychology',
                tone: 'Empathetic',
                detailLevel: 'high',
                careApproach: 'holistic',
                spirituality: false
            })
            .expect(201)

        expect(response.body).toHaveProperty('sessionId')
        expect(typeof response.body.sessionId).toBe('string')
        expect(response.body).toHaveProperty('data')
        expect(typeof response.body.data).toBe('string')
    }, 30000) // Increase timeout for LLM

    it('/chat/streaming (POST) - with new sessionId', async () => {
        const response = await request(app.getHttpServer())
            .post('/chat/streaming')
            .responseType('text')
            .send({
                prompt: 'Give me a short breathing exercise.',
                date: new Date().toISOString(),
                medicalLens: 'Psychology',
                tone: 'Empathetic',
                detailLevel: 'low',
                careApproach: 'holistic',
                spirituality: false
            })
            .expect(201)

        // Since it's a stream, we can check the buffer if text is undefined
        const bufferOrText = response.text || response.body?.toString() || (response as any).buffer?.toString()
        expect(bufferOrText).toContain('data: {"sessionId":')
        expect(bufferOrText).toContain('data: [DONE]')
    }, 30000)
})
