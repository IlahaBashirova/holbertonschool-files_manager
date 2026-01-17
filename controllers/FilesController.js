import mongodb from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const { ObjectId } = mongodb;

class FilesController {
  // keep your postUpload here

  static async getShow(req, res) {
    const token = req.header('X-Token');
    const userId = token ? await redisClient.get(`auth_${token}`) : null;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;

    let file;
    try {
      file = await dbClient.db.collection('files').findOne({
        _id: ObjectId(fileId),
        userId: ObjectId(userId),
      });
    } catch (e) {
      file = null;
    }

    if (!file) return res.status(404).json({ error: 'Not found' });

    const parentIdOut = file.parentId && file.parentId !== 0
      ? file.parentId.toString()
      : 0;

    return res.status(200).json({
      id: file._id.toString(),
      userId: file.userId.toString(),
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: parentIdOut,
    });
  }

  static async getIndex(req, res) {
    const token = req.header('X-Token');
    const userId = token ? await redisClient.get(`auth_${token}`) : null;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

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

    const formatted = files.map((file) => {
      const parentIdOut = file.parentId && file.parentId !== 0
        ? file.parentId.toString()
        : 0;

      return {
        id: file._id.toString(),
        userId: file.userId.toString(),
        name: file.name,
        type: file.type,
        isPublic: file.isPublic,
        parentId: parentIdOut,
      };
    });

    return res.status(200).json(formatted);
  }
}

export default FilesController;
