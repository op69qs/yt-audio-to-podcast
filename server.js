const config = require('nodejs-config')(
	__dirname
);
const ytAudioToPodcast = require('./youtube-audio-to-podcast.js');

const http = require("http");
const server = http.createServer(function(request, response) {
	// Parse out the YT channel name
	// Format : /[YouTube channel name]/feed.xml
	const urlParts = request.url.split('/');
	const channel = urlParts[1];
	const filename = urlParts[2];
	const mp3FileMatch = (filename || '').match(/(.*)\.mp3$/);

	if (filename === 'feed.xml' || filename === 'user.xml') {
		response.writeHead(200, {"Content-Type": "application/rss+xml;charset=utf-8"});

		ytAudioToPodcast.getPodcastRssXmlByUsername(
			channel, 
			request.url,
			'http://'+request.headers.host+'/'+channel+'/[videoId].mp3',
			function(xml) {
				response.write(xml);
				response.end();
			}
		);
	} else if (filename === 'channel.xml') {
		response.writeHead(200, {"Content-Type": "application/rss+xml;charset=utf-8"});

		ytAudioToPodcast.getPodcastRssXmlByChannelId(
			channel, 
			request.url,
			'http://'+request.headers.host+'/'+channel+'/[videoId].mp3',
			function(xml) {
				response.write(xml);
				response.end();
			}
		);
	} else if (mp3FileMatch) {
        const videoId = mp3FileMatch[1];
        const size = ytAudioToPodcast.getAudioCacheFileSize(videoId);
        let header = {
            "Content-Type": "audio/mpeg",
            'Transfer-Encoding': 'chunked',
            'connection': 'keep-alive',
            'Content-Transfer-Encoding': 'binary',
        };
        if (size > 0) {
            header['Content-Length'] = size
        }
        response.writeHead(200, header);

		const audioStream = ytAudioToPodcast.getAudioStreamByVideoId(videoId);
		audioStream.pipe(response);
	} else {
		response.writeHead(404);
		response.write('Invalid request');
		response.end();
	}
});

const port = config.get("local.port");
ytAudioToPodcast.audioSavePathInit(config.get("local.audioSavePath"))
server.listen(port);
console.log("Listening on "+port);
