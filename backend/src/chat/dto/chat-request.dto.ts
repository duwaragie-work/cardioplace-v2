import { IsNotEmpty, IsString, IsOptional } from 'class-validator'

export class ChatRequestDto {
  @IsOptional()
  @IsString()
  sessionId?: string

  @IsNotEmpty({ message: 'prompt is required' })
  @IsString()
  prompt: string

  @IsOptional()
  @IsString()
  date: string
}
