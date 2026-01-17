import Bull from 'bull';
import mongodb from 'mongodb';
import imageThumbnail from 'image-thumbnail';
import fs from 'fs';
import dbClient from './utils/db';

const { ObjectId } = mongodb;

const fileQueue = new Bull('fileQueue');

fileQueue.process(async (job) => {
  const { fileId, userId } = job.data || {};

  if (!fileId) throw new Error('Missing fileId');
  if (!userId) throw new Error('Missing userId');

  const file = await dbClient.db.collection('files').findOne({
    _id: ObjectId(fileId),
    userId: ObjectId(userId),
  });

  if (!file) throw new Error('File not found');

  const sizes = [500, 250, 100];

  await Promise.all(sizes.map(async (size) => {
    const thumbnail = await imageThumbnail(file.localPath, { width: size });
    await fs.promises.writeFile(`${file.localPath}_${size}`, thumbnail);
  }));
});
