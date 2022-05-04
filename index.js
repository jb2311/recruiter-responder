"use strict";
/* eslint-disable camelcase */

const fs = require("fs").promises;
const { google } = require("googleapis");
const readline = require("readline-sync");
var parseMessage = require('gmail-api-parse-message');

const TOKEN_PATH = "./token.json";
const SCOPES = ["https://mail.google.com/"];
let gmail;

async function run() {
  try {
    const creds = await getCreds();
    const auth = await authorize(creds);
    gmail = google.gmail({ version: 'v1', auth });

    const recruitersLabel = await getRecruiterLabel();
    const unreadMessages = await getUnreadMessagesFromLabel(recruitersLabel);

    if (unreadMessages) {
      for (let message of unreadMessages) {
        const messageData = await getMessageDetails(message)
        await replyToRecruiter(messageData)
        markMessageAsRead(messageData);
      }
    } else {
      console.log('No new messages found.');
    }
  } catch (error) {
    console.log(error)
  }
}

async function getCreds() {
  // Load client secrets from a local file.
  const content = await fs.readFile("./credentials.json")
  // Authorize a client with credentials, then call the Gmail API.
  return JSON.parse(content.toString())
}

async function authorize(credentials) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  let token;
  try {
    let tokenBuffer = await fs.readFile(TOKEN_PATH);
    token = JSON.parse(tokenBuffer.toString());


  } catch (error) {
    token = await getNewToken(oAuth2Client);
  }

  oAuth2Client.setCredentials(token)
  return oAuth2Client;
}

async function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES
  });

  console.log("Authorize this app by visiting this url:", authUrl);

  const code = readline.question("Enter the code from that page here: ");
  const token = (await oAuth2Client.getToken(code)).tokens;
  oAuth2Client.setCredentials(token);
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token))

  return token;
}

async function getRecruiterLabel() {
  const res = await gmail.users.labels.list({
    userId: 'me',
  })
  const labels = res.data.labels;
  if (labels.length > 0) {
    const recruitersLabel = labels.find((label) => label.name === 'Recruiters')

    if (!recruitersLabel) {
      console.log('No Recruiters Label')
    }

    return recruitersLabel;
  } else {
    console.log('No labels found.');
  }
}

async function getUnreadMessagesFromLabel(label) {
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread',
    labelIds: [label.id]
  });
  const { messages } = res.data;
  return messages;
}

async function getMessageDetails(message) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: message.id
  });

  return parseMessage(res.data);
}


async function replyToRecruiter(message) {
  const emailHtml = await fs.readFile('./email.html');

  const messageParts = [
    `From: ${message.headers.to}`,
    `To: ${message.headers.from}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `References: ${message.headers.references} ${message.headers['message-id']}`,
    `In-Reply-To: ${message.headers['message-id']}`,
    `Subject: Re:${message.headers.subject}`,
    '',
    emailHtml.toString()
  ];

  const messageToSend = messageParts.join('\n');

  // The body needs to be base64url encoded.
  const encodedMessage = Buffer.from(messageToSend)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      threadId: message.threadId
    }
  });
}

async function markMessageAsRead(message) {
  await gmail.users.messages.modify({
    userId: 'me',
    id: message.id,
    resource: {
      removeLabelIds: ['UNREAD']
    }
  });
}

run()