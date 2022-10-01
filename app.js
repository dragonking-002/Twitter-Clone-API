const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

let db = null;
const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3004, () => {
      console.log("Server is Running at http://localhost:3004/");
    });
  } catch (err) {
    console.log(err.message);
    process.exit(1);
  }
};

initializeDBAndServer();

const validateCredentials = async (request, response, next) => {
  const { username, password } = request.body;
  const dbQuery = ` SELECT * FROM user WHERE username = '${username}' ; `;
  const dbUser = await db.get(dbQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    next();
  }
};

app.post("/register/", validateCredentials, async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const dbQuery = ` INSERT INTO user(name, username, password, gender) 
                        VALUES(
                            '${name}',
                            '${username}',
                            '${hashedPassword}',
                            '${gender}'
                        ); `;
  await db.run(dbQuery);
  response.status(200);
  response.send("User created successfully");
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const dbQuery = ` SELECT * FROM user WHERE username = '${username}' ; `;
  const dbUser = await db.get(dbQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isCorrect = await bcrypt.compare(password, dbUser.password);
    if (isCorrect === false) {
      response.status(400);
      response.send("Invalid password");
    } else {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_TOKEN");
      response.send({ jwtToken });
    }
  }
});

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        const dbQuery = ` SELECT * FROM user WHERE username = '${payload.username}'; `;
        const dbUser = await db.get(dbQuery);
        request.userId = dbUser.user_id;
        next();
      }
    });
  }
}

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { userId } = request;
  const dbQuery = ` SELECT user.username AS userName, tweet.tweet AS tweet, tweet.date_time AS dateTime 
                        FROM follower INNER JOIN tweet  
                        ON follower.following_user_id = tweet.user_id  
                        INNER JOIN user ON user.user_id = tweet.user_id 
                        WHERE follower.follower_user_id = ${userId} 
                        ORDER BY tweet.date_time DESC 
                        LIMIT 4; `;
  const tweetsArray = await db.all(dbQuery);
  response.send(
    tweetsArray.map((each) => ({
      username: each.userName,
      tweet: each.tweet,
      dateTime: each.dateTime,
    }))
  );
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const dbQuery = ` SELECT name FROM user INNER JOIN follower 
                        ON user.user_id = follower.following_user_id 
                        WHERE follower.follower_user_id = ${userId}; `;
  const followingArray = await db.all(dbQuery);
  response.send(followingArray.map((each) => ({ name: each.name })));
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const dbQuery = ` SELECT name FROM user INNER JOIN follower
                        ON user.user_id = follower.follower_user_id
                        WHERE following_user_id = ${userId}; `;
  const followersArray = await db.all(dbQuery);
  response.send(followersArray.map((each) => ({ name: each.name })));
});

const validateRequest = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const dbQuery1 = ` SELECT following_user_id FROM follower 
                            WHERE follower_user_id = ${userId}; `;
  let followingArray = await db.all(dbQuery1);
  followingArray = followingArray.map((each) => each.following_user_id);
  const dbQuery2 = `  SELECT user_id FROM tweet WHERE tweet_id = ${tweetId}; `;
  const user = await db.get(dbQuery2);
  if (followingArray.includes(user.user_id) === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery1 = ` SELECT tweet,date_time FROM tweet WHERE tweet_id = ${tweetId}; `;
    const dbQuery2 = ` SELECT COUNT(*) AS replies FROM reply WHERE tweet_id = ${tweetId}; `;
    const dbQuery3 = ` SELECT COUNT(*) AS likes FROM like WHERE tweet_id = ${tweetId}; `;
    const tweetObj = await db.get(dbQuery1);
    const replyObj = await db.get(dbQuery2);
    const likeObj = await db.get(dbQuery3);
    response.send({
      tweet: tweetObj.tweet,
      likes: likeObj.likes,
      replies: replyObj.replies,
      dateTime: tweetObj.date_time,
    });
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery = ` SELECT username FROM user INNER JOIN like
                        ON user.user_id = like.user_id
                        WHERE tweet_id = ${tweetId} ; `;
    const likesArray = await db.all(dbQuery);
    response.send({ likes: likesArray.map((each) => each.username) });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery = ` SELECT user.name, reply.reply FROM  user INNER JOIN reply 
                        ON user.user_id = reply.user_id 
                        WHERE tweet_id = ${tweetId}; `;
    const repliesArray = await db.all(dbQuery);
    response.send({ replies: repliesArray });
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const dbQuery = ` SELECT tweet.tweet_id, tweet.tweet, COUNT(DISTINCT(like_id)) AS likes, 
                        COUNT(DISTINCT(reply_id)) AS replies, tweet.date_time FROM 
                        tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
                        LEFT JOIN reply ON reply.tweet_id = tweet.tweet_id
                        WHERE tweet.user_id = ${userId}
                        GROUP BY tweet.tweet_id; `;
  const tweetsArray = await db.all(dbQuery);
  response.send(tweetsArray.map((each) => ({tweet: each.tweet, likes: each.likes, replies: each.replies, dateTime: each.date_time})));
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const { tweet } = request.body;
  const dateTime = new Date()
    .toISOString()
    .replace(/T/, " ")
    .replace(/\..+/, "");
  const dbQuery = ` INSERT INTO tweet(tweet,user_id,date_time) 
                        VALUES(
                            '${tweet}',
                            ${userId},
                            '${dateTime}'
                        ); `;
  await db.run(dbQuery);
  response.send("Created a Tweet");
});

const validateTweetId = async (request, response, next) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const dbQuery = ` SELECT tweet_id FROM tweet WHERE user_id = ${userId}; `;
  let tweetsArray = await db.all(dbQuery);
  tweetsArray = tweetsArray.map((each) => each.tweet_id);

  if (tweetsArray.includes(Number(tweetId)) === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  validateTweetId,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery = ` DELETE FROM tweet WHERE tweet_id = ${tweetId}; `;
    await db.run(dbQuery);
    response.send("Tweet Removed");
  }
);

module.exports = app;
const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

let db = null;
const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3004, () => {
      console.log("Server is Running at http://localhost:3004/");
    });
  } catch (err) {
    console.log(err.message);
    process.exit(1);
  }
};

initializeDBAndServer();

const validateCredentials = async (request, response, next) => {
  const { username, password } = request.body;
  const dbQuery = ` SELECT * FROM user WHERE username = '${username}' ; `;
  const dbUser = await db.get(dbQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    next();
  }
};

app.post("/register/", validateCredentials, async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const dbQuery = ` INSERT INTO user(name, username, password, gender) 
                        VALUES(
                            '${name}',
                            '${username}',
                            '${hashedPassword}',
                            '${gender}'
                        ); `;
  await db.run(dbQuery);
  response.status(200);
  response.send("User created successfully");
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const dbQuery = ` SELECT * FROM user WHERE username = '${username}' ; `;
  const dbUser = await db.get(dbQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isCorrect = await bcrypt.compare(password, dbUser.password);
    if (isCorrect === false) {
      response.status(400);
      response.send("Invalid password");
    } else {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_TOKEN");
      response.send({ jwtToken });
    }
  }
});

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        const dbQuery = ` SELECT * FROM user WHERE username = '${payload.username}'; `;
        const dbUser = await db.get(dbQuery);
        request.userId = dbUser.user_id;
        next();
      }
    });
  }
}

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { userId } = request;
  const dbQuery = ` SELECT user.username AS userName, tweet.tweet AS tweet, tweet.date_time AS dateTime 
                        FROM follower INNER JOIN tweet  
                        ON follower.following_user_id = tweet.user_id  
                        INNER JOIN user ON user.user_id = tweet.user_id 
                        WHERE follower.follower_user_id = ${userId} 
                        ORDER BY tweet.date_time DESC 
                        LIMIT 4; `;
  const tweetsArray = await db.all(dbQuery);
  response.send(
    tweetsArray.map((each) => ({
      username: each.userName,
      tweet: each.tweet,
      dateTime: each.dateTime,
    }))
  );
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const dbQuery = ` SELECT name FROM user INNER JOIN follower 
                        ON user.user_id = follower.following_user_id 
                        WHERE follower.follower_user_id = ${userId}; `;
  const followingArray = await db.all(dbQuery);
  response.send(followingArray.map((each) => ({ name: each.name })));
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const dbQuery = ` SELECT name FROM user INNER JOIN follower
                        ON user.user_id = follower.follower_user_id
                        WHERE following_user_id = ${userId}; `;
  const followersArray = await db.all(dbQuery);
  response.send(followersArray.map((each) => ({ name: each.name })));
});

const validateRequest = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const dbQuery1 = ` SELECT following_user_id FROM follower 
                            WHERE follower_user_id = ${userId}; `;
  let followingArray = await db.all(dbQuery1);
  followingArray = followingArray.map((each) => each.following_user_id);
  const dbQuery2 = `  SELECT user_id FROM tweet WHERE tweet_id = ${tweetId}; `;
  const user = await db.get(dbQuery2);
  if (followingArray.includes(user.user_id) === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery1 = ` SELECT tweet,date_time FROM tweet WHERE tweet_id = ${tweetId}; `;
    const dbQuery2 = ` SELECT COUNT(*) AS replies FROM reply WHERE tweet_id = ${tweetId}; `;
    const dbQuery3 = ` SELECT COUNT(*) AS likes FROM like WHERE tweet_id = ${tweetId}; `;
    const tweetObj = await db.get(dbQuery1);
    const replyObj = await db.get(dbQuery2);
    const likeObj = await db.get(dbQuery3);
    response.send({
      tweet: tweetObj.tweet,
      likes: likeObj.likes,
      replies: replyObj.replies,
      dateTime: tweetObj.date_time,
    });
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery = ` SELECT username FROM user INNER JOIN like
                        ON user.user_id = like.user_id
                        WHERE tweet_id = ${tweetId} ; `;
    const likesArray = await db.all(dbQuery);
    response.send({ likes: likesArray.map((each) => each.username) });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  validateRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery = ` SELECT user.name, reply.reply FROM  user INNER JOIN reply 
                        ON user.user_id = reply.user_id 
                        WHERE tweet_id = ${tweetId}; `;
    const repliesArray = await db.all(dbQuery);
    response.send({ replies: repliesArray });
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const dbQuery = ` SELECT tweet.tweet_id, tweet.tweet, COUNT(DISTINCT(like_id)) AS likes, 
                        COUNT(DISTINCT(reply_id)) AS replies, tweet.date_time FROM 
                        tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
                        LEFT JOIN reply ON reply.tweet_id = tweet.tweet_id
                        WHERE tweet.user_id = ${userId}
                        GROUP BY tweet.tweet_id; `;
  const tweetsArray = await db.all(dbQuery);
  response.send(tweetsArray.map((each) => ({tweet: each.tweet, likes: each.likes, replies: each.replies, dateTime: each.date_time})));
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const { tweet } = request.body;
  const dateTime = new Date()
    .toISOString()
    .replace(/T/, " ")
    .replace(/\..+/, "");
  const dbQuery = ` INSERT INTO tweet(tweet,user_id,date_time) 
                        VALUES(
                            '${tweet}',
                            ${userId},
                            '${dateTime}'
                        ); `;
  await db.run(dbQuery);
  response.send("Created a Tweet");
});

const validateTweetId = async (request, response, next) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const dbQuery = ` SELECT tweet_id FROM tweet WHERE user_id = ${userId}; `;
  let tweetsArray = await db.all(dbQuery);
  tweetsArray = tweetsArray.map((each) => each.tweet_id);

  if (tweetsArray.includes(Number(tweetId)) === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  validateTweetId,
  async (request, response) => {
    const { tweetId } = request.params;
    const dbQuery = ` DELETE FROM tweet WHERE tweet_id = ${tweetId}; `;
    await db.run(dbQuery);
    response.send("Tweet Removed");
  }
);

module.exports = app;
