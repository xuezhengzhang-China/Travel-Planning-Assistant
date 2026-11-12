exports.up = (pgm) => {
  // Keep nullable for existing rows; only accounts with a hash can authenticate.
  pgm.addColumn('users', {
    password_hash: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'password_hash');
};
