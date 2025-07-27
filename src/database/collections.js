import { initDatabase } from './database';
import { businessSchema, articleSchema } from './schemas';

export const setupCollections = async () => {
  const db = await initDatabase();

  await db.addCollections({
    businesses: { schema: businessSchema },
    articles: { schema: articleSchema },
  });

  return db;
};
