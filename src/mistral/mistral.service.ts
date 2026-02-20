import { Mistral } from '@mistralai/mistralai'
import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class MistralService implements OnModuleInit {
  private client: Mistral
  private embedModel: string | undefined
  private chatModel: string | undefined

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('MISTRAL_API_KEY')
    this.embedModel = this.configService.get<string>('MISTRAL_EMBED_MODEL')
    this.chatModel = this.configService.get<string>('MISTRAL_CHAT_MODEL')

    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY is not defined in environment locations')
    }

    this.client = new Mistral({ apiKey: apiKey })
  }

  get clientInstance(): Mistral {
    return this.client
  }

  async getChatCompletion(messages: Array<any>) {
    if (!this.chatModel) {
      throw new Error('MISTRAL_CHAT_MODEL is not defined')
    }
    return await this.client.chat.complete({
      model: this.chatModel,
      messages: messages,
    })
  }

  async getEmbeddings(input: string | string[]) {
    if (!this.embedModel) {
      throw new Error('MISTRAL_EMBED_MODEL is not defined')
    }
    const inputs = Array.isArray(input) ? input : [input]
    return await this.client.embeddings.create({
      model: this.embedModel,
      inputs: inputs,
    })
  }
}
