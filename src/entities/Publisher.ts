export interface Publisher {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublisherDTO {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export function toPublisherDTO(publisher: Publisher): PublisherDTO {
  return {
    id: publisher.id,
    userId: publisher.userId,
    name: publisher.name,
    createdAt: publisher.createdAt.toISOString(),
    updatedAt: publisher.updatedAt.toISOString(),
  };
}
