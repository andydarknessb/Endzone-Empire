const bcrypt = require('bcryptjs');

const SALT_WORK_FACTOR = Number(process.env.BCRYPT_COST || 12);

const encryptPassword = (password) => bcrypt.hash(password, SALT_WORK_FACTOR);

const comparePassword = (candidatePassword, storedPassword) =>
  bcrypt.compare(candidatePassword, storedPassword);

module.exports = {
  comparePassword,
  encryptPassword,
  SALT_WORK_FACTOR,
};
