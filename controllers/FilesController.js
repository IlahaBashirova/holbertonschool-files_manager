// controllers/FilesController.js
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import mongodb from 'mongodb';
import mime from 'mime-types';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = mongodb;

const waitForMongo = async (maxTries = 50, delayMs = 100) => {
  for (let i = 0; i < maxTries; i += 1) {
    if (dbClient.isAlive && dbClient.isAlive()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
};

const formatFile = (file) => ({
  id: file._id.toString(),
  userId: file.userId.toString(),
  name: file.name,
  type: file.type,
  isPublic: file.isPublic,
  parentId: file.parentId && file.parentId !== 0 ? file.parentId.toString() : 0,
});

class FilesController {
  static async postUpload(req, res) {
    const token = req.header('X-Token');
    const userId = token ? await redisClient.get(`auth_${token}`) : null;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const mongoReady = await waitForMongo();
    if (!mongoReady) return res.status(401).json({ error: 'Unauthorized' });

    const {
      name,
      type,
      parentId = 0,
      isPublic = false,
      data,
    } = req.body || {};

    if (!name) return res.status(400).json({ error: 'Missing name' });

    const allowedTypes = ['folder', 'file', 'image'];
    if (!type || !allowedTypes.includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if (type !== 'folder' && !data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const filesCollection = dbClient.db.collection('files');

    let parentIdValue = 0;
    if (parentId !== 0 && parentId !== '0') {
      let parent;
      try {
        parent = await filesCollection.findOne({ _id: ObjectId(parentId) });
      } catch (e) {
        parent = null;
      }

      if (!parent) return res.status(400).json({ error: 'Parent not found' });
      if (parent.type !== 'folder') {
        return res.status(400).json({ error: 'Parent is not a folder' });
      }

      parentIdValue = ObjectId(parentId);
    }

    const newFile = {
      userId: ObjectId(userId),
      name,
      type,
      isPublic,
      parentId: parentIdValue,
    };

    if (type === 'folder') {
      const result = await filesCollection.insertOne(newFile);
      return res.status(201).json(formatFile({ ...newFile, _id: result.insertedId }));
    }

    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    await fs.promises.mkdir(folderPath, { recursive: true });

    const filename = uuidv4();
    const localPath = `${folderPath}/${filename}`;
    await fs.promises.writeFile(localPath, Buffer.from(data, 'base64'));

    newFile.localPath = localPath;

    const result = await filesCollection.insertOne(newFile);
    return res.status(201).json(formatFile({ ...newFile, _id: result.insertedId }));
  }

  static async getShow(req, res) {
    try {
      const token = req.header('X-Token');
      const userId = token ? await redisClient.get(`auth_${token}`) : null;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const mongoReady = await waitForMongo();
      if (!mongoReady) return res.status(404).json({ error: 'Not found' });

      const file = await dbClient.db.collection('files').findOne({
        _id: ObjectId(req.params.id),
        userId: ObjectId(userId),
      });

      if (!file) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(formatFile(file));
    } catch (e) {
      return res.status(404).json({ error: 'Not found' });
    }
  }

  static async getIndex(req, res) {
    try {
      const token = req.header('X-Token');
      const userId = token ? await redisClient.get(`auth_${token}`) : null;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const mongoReady = await waitForMongo();
      if (!mongoReady) return res.status(200).json([]);

      const parentId = req.query.parentId || 0;
      const page = Number(req.query.page || 0);

      const match = {
        userId: ObjectId(userId),
        parentId: 0,
      };

      if (parentId !== 0 && parentId !== '0') {
        try {
          match.parentId = ObjectId(parentId);
        } catch (e) {
          return res.status(200).json([]);
        }
      }

      const files = await dbClient.db.collection('files').aggregate([
        { $match: match },
        { $sort: { _id: 1 } },
        { $skip: page * 20 },
        { $limit: 20 },
      ]).toArray();

      return res.status(200).json(files.map((f) => formatFile(f)));
    } catch (e) {
      return res.status(200).json([]);
    }
  }

  static async putPublish(req, res) {
    try {
      const token = req.header('X-Token');
      const userId = token ? await redisClient.get(`auth_${token}`) : null;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const fileId = req.params.id;

      const file = await dbClient.db.collection('files').findOne({
        _id: ObjectId(fileId),
        userId: ObjectId(userId),
      });

      if (!file) return res.status(404).json({ error: 'Not found' });

      await dbClient.db.collection('files').updateOne(
        { _id: ObjectId(fileId) },
        { $set: { isPublic: true } },
      );

      const updated = await dbClient.db.collection('files').findOne({
        _id: ObjectId(fileId),
        userId: ObjectId(userId),
      });

      return res.status(200).json(formatFile(updated));
    } catch (e) {
      return res.status(404).json({ error: 'Not found' });
    }
  }

  static async putUnpublish(req, res) {
    try {
      const token = req.header('X-Token');
      const userId = token ? await redisClient.get(`auth_${token}`) : null;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const fileId = req.params.id;

      const file = await dbClient.db.collection('files').findOne({
        _id: ObjectId(fileId),
        userId: ObjectId(userId),
      });

      if (!file) return res.status(404).json({ error: 'Not found' });

      await dbClient.db.collection('files').updateOne(
        { _id: ObjectId(fileId) },
        { $set: { isPublic: false } },
      );

      const updated = await dbClient.db.collection('files').findOne({
        _id: ObjectId(fileId),
        userId: ObjectId(userId),
      });

      return res.status(200).json(formatFile(updated));
    } catch (e) {
      return res.status(404).json({ error: 'Not found' });
    }
  }

  static async getFile(req, res) {
    try {
      const mongoReady = await waitForMongo();
      if (!mongoReady) return res.status(404).json({ error: 'Not found' });

      let file;
      try {
        file = await dbClient.db.collection('files').findOne({ _id: ObjectId(req.params.id) });
      } catch (e) {
        file = null;
      }

      if (!file) return res.status(404).json({ error: 'Not found' });

      // If not public -> only owner with valid token can access
      if (!file.isPublic) {
        const token = req.header('X-Token');
        const userId = token ? await redisClient.get(`auth_${token}`) : null;

        if (!userId || file.userId.toString() !== userId.toString()) {
          return res.status(404).json({ error: 'Not found' });
        }
      }

      if (file.type === 'folder') {
        return res.status(400).json({ error: "A folder doesn't have content" });
      }

      if (!file.localPath) return res.status(404).json({ error: 'Not found' });

      try {
        await fs.promises.access(file.localPath, fs.constants.F_OK);
      } catch (e) {
        return res.status(404).json({ error: 'Not found' });
      }

      const content = await fs.promises.readFile(file.localPath);

      const mimeType = mime.contentType(file.name) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      return res.status(200).send(content);
    } catch (e) {
      return res.status(404).json({ error: 'Not found' });
    }
  }
}

export default FilesController;
