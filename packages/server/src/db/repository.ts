import { randomUUID } from 'node:crypto';
import type { Collection, Filter, MatchKeysAndValues, Sort } from 'mongodb';
import type { z } from 'zod';
import { getDatabase } from './client.js';

/**
 * Mongo's own `Document` type assumes an `ObjectId` `_id`. These documents use
 * string UUIDs, so filters are typed against this instead — otherwise every
 * `findById` needs a cast that would also hide real mistakes.
 */
export interface StoredDocument {
  _id: string;
  [key: string]: unknown;
}

export type DocFilter = Filter<StoredDocument>;

/**
 * A thin, Zod-validated layer over a Mongo collection.
 *
 * There is no ODM here on purpose. The Zod schema is already the single
 * definition of every model, and an ODM would mean writing each one twice and
 * keeping the two in step. Instead every document is parsed through its schema
 * on the way out of the database, so a document written by an older version of
 * the code — or by hand in a shell — fails loudly at the boundary rather than
 * flowing into the app as a wrongly-typed object.
 */

export interface BaseDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertInput<TDoc extends BaseDoc> = Omit<TDoc, '_id' | 'createdAt' | 'updatedAt'> & {
  _id?: string;
};

export type UpdatePatch<TDoc extends BaseDoc> = Partial<Omit<TDoc, '_id' | 'createdAt'>>;

export interface FindOptions {
  sort?: Sort;
  limit?: number;
  skip?: number;
}

export class Repository<TDoc extends BaseDoc> {
  constructor(
    public readonly collectionName: string,
    private readonly schema: z.ZodType<TDoc, z.ZodTypeDef, any>,
  ) {}

  /** Escape hatch for aggregations and bulk writes. Prefer the methods below. */
  get collection(): Collection<StoredDocument> {
    return getDatabase().collection<StoredDocument>(this.collectionName);
  }

  /** Validate an arbitrary value as a document of this collection. */
  parse(raw: unknown): TDoc {
    return this.schema.parse(raw);
  }

  private parseAll(raws: unknown[]): TDoc[] {
    return raws.map((raw) => this.schema.parse(raw));
  }

  async insert(input: InsertInput<TDoc>): Promise<TDoc> {
    const now = new Date();
    const doc = this.schema.parse({
      ...input,
      _id: input._id ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    await this.collection.insertOne(doc as unknown as StoredDocument);
    return doc;
  }

  async insertMany(inputs: readonly InsertInput<TDoc>[]): Promise<TDoc[]> {
    if (inputs.length === 0) return [];
    const now = new Date();
    const docs = inputs.map((input) =>
      this.schema.parse({
        ...input,
        _id: input._id ?? randomUUID(),
        createdAt: now,
        updatedAt: now,
      }),
    );
    await this.collection.insertMany(docs as unknown as StoredDocument[]);
    return docs;
  }

  async findById(id: string): Promise<TDoc | null> {
    const raw = await this.collection.findOne({ _id: id });
    return raw ? this.schema.parse(raw) : null;
  }

  /** Like `findById`, but throws when the document is missing. */
  async requireById(id: string): Promise<TDoc> {
    const doc = await this.findById(id);
    if (!doc) {
      throw new NotFoundError(`${this.collectionName} "${id}" was not found`);
    }
    return doc;
  }

  async findOne(filter: DocFilter, options: FindOptions = {}): Promise<TDoc | null> {
    const raw = await this.collection.findOne(filter, { sort: options.sort });
    return raw ? this.schema.parse(raw) : null;
  }

  async find(filter: DocFilter = {}, options: FindOptions = {}): Promise<TDoc[]> {
    let cursor = this.collection.find(filter);
    if (options.sort) cursor = cursor.sort(options.sort);
    if (options.skip) cursor = cursor.skip(options.skip);
    if (options.limit) cursor = cursor.limit(options.limit);
    return this.parseAll(await cursor.toArray());
  }

  async count(filter: DocFilter = {}): Promise<number> {
    return this.collection.countDocuments(filter);
  }

  async exists(filter: DocFilter): Promise<boolean> {
    return (await this.collection.countDocuments(filter, { limit: 1 })) > 0;
  }

  async updateById(id: string, patch: UpdatePatch<TDoc>): Promise<TDoc> {
    const raw = await this.collection.findOneAndUpdate(
      { _id: id },
      { $set: { ...patch, updatedAt: new Date() } as MatchKeysAndValues<StoredDocument> },
      { returnDocument: 'after' },
    );
    if (!raw) {
      throw new NotFoundError(`${this.collectionName} "${id}" was not found`);
    }
    return this.schema.parse(raw);
  }

  async updateMany(filter: DocFilter, patch: UpdatePatch<TDoc>): Promise<number> {
    const result = await this.collection.updateMany(filter, {
      $set: { ...patch, updatedAt: new Date() } as MatchKeysAndValues<StoredDocument>,
    });
    return result.modifiedCount;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }

  async deleteMany(filter: DocFilter): Promise<number> {
    const result = await this.collection.deleteMany(filter);
    return result.deletedCount;
  }
}

/** Thrown when a document a caller depends on does not exist. */
export class NotFoundError extends Error {
  readonly code = 'not_found';
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a request is well-formed but not valid for the current state. */
export class ConflictError extends Error {
  readonly code = 'conflict';
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
