import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import mongodb from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = mongodb;

class FilesController {
  static async postUpload(req, res) {
    const token = req.header('X-Token');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      name,
      type,
      parentId = 0,
      isPublic = false,
      data,
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }

    const allowedTypes = ['folder', 'file', 'image'];
    if (!type || !allowedTypes.includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if (type !== 'folder' && !data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const filesCollection = dbClient.db.collection('files');

    // Validate parentId if not root
    let parentIdValue = 0;
    if (parentId && parentId !== 0 && parentId !== '0') {
      let parent;
      try {
        parent = await filesCollection.findOne({ _id: ObjectId(parentId) });
      } catch (e) {
        parent = null;
      }

      if (!parent) {
        return res.status(400).json({ error: 'Parent not found' });
      }
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

    // If folder, only save in DB
    if (type === 'folder') {
      const result = await filesCollection.insertOne(newFile);
      return res.status(201).json({
        id: result.insertedId.toString(),
        userId,
        name,
        type,
        isPublic,
        parentId: parentIdValue === 0 ? 0 : parentIdValue.toString(),
      });
    }

    // If file/image, save on disk
    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    await fs.promises.mkdir(folderPath, { recursive: true });

    const filename = uuidv4();
    const localPath = `${folderPath}/${filename}`;

    const fileBuffer = Buffer.from(data, 'base64');
    await fs.promises.writeFile(localPath, fileBuffer);

    newFile.localPath = localPath;

    const result = await filesCollection.insertOne(newFile);

    return res.status(201).json({
      id: result.insertedId.toString(),
      userId,
      name,
      type,
      isPublic,
      parentId: parentIdValue === 0 ? 0 : parentIdValue.toString(),
    });
  }
}

export default FilesController;
