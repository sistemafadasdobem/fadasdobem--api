DOCUMENTACAO ATUAL DO AGORA.IO:

---
title: RESTful authentication
description: Setup authentication for RESTful communication between your app and Agora.
sidebar_position: 10
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/restful-authentication
exported_on: '2026-05-01T05:34:25.946192Z'
exported_file: restful-authentication.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/restful-authentication)

# RESTful authentication

Conversational AI Engine RESTful API requires REST authentication.
The following REST authentication methods are available:

- **Token authentication**

    Token authentication uses an RTC token generated on your server using your app ID and app certificate. 

- **Basic HTTP authentication**

    Generate a Base64-encoded credential with the [customer ID and customer secret](#generate-customer-id-and-customer-secret) provided by Agora and pass the credential with the `Authorization` parameter in the request header.


## Implement token authentication

Token authentication uses an RTC token generated on your server using your app ID and app certificate. A token is scoped to a specific app ID and channel, making it the preferred method for production environments.

To authenticate using a token, include the `Authorization` header in each request:

```
Authorization: agora token=<your_token>
```

### Prerequisites

Before you begin, ensure that you have the following from [Agora Console](https://console.agora.io/v2):

- **App ID**: A unique string that identifies your project.
- **App Certificate**: A string used to generate tokens. 

> ⚠️ **Caution**
> Never expose your App Certificate in client-side code or public repositories. Generate tokens on your server only.

The Agora RESTful API only supports HTTPS with TLS 1.0, 1.1, or 1.2 for encrypted communication. Requests over plain HTTP are not supported and will fail to connect.

### Using the Conversational AI SDK

If you are already using the Conversational AI SDK in your project, use the SDK token generation utility to generate tokens. If you want a standalone token generation dependency without the full SDK, use the Agora [token builder library](#using-the-token-builder-library).

#### Install the SDK

The Agora Conversational AI SDKs include a built-in token generation utility. Install the SDK for your language, or skip this step if it is already part of your project.

**Node.js**
Use your preferred package manager to install the SDK:

```bash
npm install agora-agent-server-sdk
```

**Golang**
Add it as a dependency using `go get`:

```bash
go get github.com/AgoraIO-Conversational-AI/agent-server-sdk-go
```

**Python**
Use `pip` to install the SDK:

```bash
pip install agent-server-sdk-python
```


#### Sample code

The following sample code generates a token and uses it to start a Conversational AI agent. 

**Node.js**
```js
const https = require('https');
const { generateConvoAIToken } = require('agora-agent-server-sdk');

// App credentials. Keep these on the server and never expose them to clients
const appId = '<your_app_id>';
const appCertificate = '<your_app_certificate>';

// Token parameters. channelName must match properties.channel in the request body
const channelName = '<your_channel_name>';
const agentUid = '<your_agent_uid>';          // Must match agent_rtc_uid in the request body
const tokenExpirationInSeconds = 86400;       // Valid range: 1–86400 (24 hours maximum)

// Generate the token
const token = generateConvoAIToken({
  appId,
  appCertificate,
  channelName,
  account: agentUid,
  tokenExpire: tokenExpirationInSeconds,
});

// Use the token to start a Conversational AI agent
const data = JSON.stringify({
  name: '<agent_identifier>',
  pipeline_id: '<your_agents_pipeline_id>',
  properties: {
    channel: channelName,
    // The token the agent uses to join the RTC channel. This is a separate
    // token from the Authorization header token, but in most cases the same
    // value can be used for both.
    token: token,
    agent_rtc_uid: agentUid,
    remote_rtc_uids: ['<remote_user_uid>'],
    enable_string_uid: false,
  },
});

const options = {
  hostname: 'api.agora.io',
  path: `/api/conversational-ai-agent/v2/projects/${appId}/join`,
  method: 'POST',
  headers: {
    'Authorization': 'agora token=' + token,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};

const req = https.request(options, (res) => {
  console.log(`Status code: ${res.statusCode}`);
  res.on('data', (d) => { process.stdout.write(d); });
});

req.on('error', (error) => { console.error(error); });
req.write(data);
req.end();
```

To use string UIDs, pass a string value for `agentUid` and set `enable_string_uid` to `true` in the request body accordingly.

**Golang**
```go
package main

import (
	"bytes"
	"fmt"
	"net/http"

	"github.com/AgoraIO-Conversational-AI/agent-server-sdk-go/agentkit"
)

func main() {
	// App credentials. Keep these on the server and never expose them to clients
	appId := "<your_app_id>"
	appCertificate := "<your_app_certificate>"

	// Token parameters. channelName must match properties.channel in the request body
	channelName := "<your_channel_name>"
	agentUid := "<your_agent_uid>"  // Must match agent_rtc_uid in the request body
	tokenExpirationInSeconds, _ := agentkit.ExpiresInHours(24) // Valid range: 1–86400 (24 hours maximum)

	// Generate the token
	token, err := agentkit.GenerateConvoAIToken(agentkit.GenerateConvoAITokenOptions{
		AppID:          appId,
		AppCertificate: appCertificate,
		ChannelName:    channelName,
		Account:        agentUid,
		TokenExpire:    tokenExpirationInSeconds,
	})
	if err != nil {
		fmt.Printf("Failed to generate token: %v\n", err)
		return
	}

	// Use the token to start a Conversational AI agent
	body := fmt.Sprintf(`{
  "name": "<agent_identifier>",
  "pipeline_id": "<your_agents_pipeline_id>",
  "properties": {
    "channel": "%s",
    "token": "%s",
    "agent_rtc_uid": "%s",
    "remote_rtc_uids": ["<remote_user_uid>"],
    "enable_string_uid": false
  }
}`, channelName, token, agentUid)

	url := fmt.Sprintf("https://api.agora.io/api/conversational-ai-agent/v2/projects/%s/join", appId)

	req, err := http.NewRequest("POST", url, bytes.NewBufferString(body))
	if err != nil {
		fmt.Printf("Failed to create request: %v\n", err)
		return
	}

	req.Header.Set("Authorization", "agora token="+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Request failed: %v\n", err)
		return
	}
	defer resp.Body.Close()

	fmt.Printf("Status code: %d\n", resp.StatusCode)
}
```

To use string UIDs, pass a string value for `agentUid` and set `enable_string_uid` to `true` in the request body.

**Python**
```python
import json
import http.client
from agora_agent.agentkit.token import generate_convo_ai_token

# App credentials. Keep these on the server and never expose them to clients
app_id = '<your_app_id>'
app_certificate = '<your_app_certificate>'

# Token parameters. channel_name must match properties.channel in the request body
channel_name = '<your_channel_name>'
agent_uid = '<your_agent_uid>'            # Must match agent_rtc_uid in the request body
token_expiration_in_seconds = 86400       # Valid range: 1–86400 (24 hours maximum)

# Generate the token
token = generate_convo_ai_token(
    app_id=app_id,
    app_certificate=app_certificate,
    channel_name=channel_name,
    account=agent_uid,
    token_expire=token_expiration_in_seconds,
)

# Use the token to start a Conversational AI agent
payload = json.dumps({
    'name': '<agent_identifier>',
    'pipeline_id': '<your_agents_pipeline_id>',
    'properties': {
        'channel': channel_name,
        # The token the agent uses to join the RTC channel. This is a separate
        # token from the Authorization header token, but in most cases the same
        # value can be used for both.
        'token': token,
        'agent_rtc_uid': agent_uid,
        'remote_rtc_uids': ['<remote_user_uid>'],
        'enable_string_uid': False,
    }
})

headers = {
    'Authorization': 'agora token=' + token,
    'Content-Type': 'application/json'
}

conn = http.client.HTTPSConnection('api.agora.io')
conn.request(
    'POST',
    f'/api/conversational-ai-agent/v2/projects/{app_id}/join',
    payload,
    headers
)

res = conn.getresponse()
print(f'Status code: {res.status}')
print(res.read().decode('utf-8'))
```

To use string UIDs, pass a string value for `agent_uid` and set `enable_string_uid` to `True` in the request body accordingly.


### Using the token builder library

The [AgoraDynamicKey repository](https://github.com/AgoraIO/Tools/tree/master/DynamicKey/AgoraDynamicKey) provides open-source token generation libraries for multiple languages.

#### Install the library

**Node.js**
Use your preferred package manager to install the library:

```bash
npm install agora-token
```

**Golang**
Add it as a dependency using `go get`:

```bash
go get github.com/AgoraIO/Tools/DynamicKey/AgoraDynamicKey/go/src/rtctokenbuilder2
```

**Python**
Clone the [AgoraDynamicKey repository](https://github.com/AgoraIO/Tools) and navigate to the Python3 token builder source directory:

```bash
git clone https://github.com/AgoraIO/Tools.git
cd Tools/DynamicKey/AgoraDynamicKey/python3/src
```


#### Sample code

The following sample code generates a token and uses it to start a Conversational AI agent.

**Node.js**
```js
const https = require('https');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

// App credentials. Keep these on the server and never expose them to clients
const appId = '<your_app_id>';
const appCertificate = '<your_app_certificate>';

// Token parameters. channelName must match properties.channel in the request body
const channelName = '<your_channel_name>';
const agentUid = '<your_agent_uid>';          // Must match agent_rtc_uid in the request body
const tokenExpirationInSeconds = 86400;       // Valid range: 1–86400 (24 hours maximum)
const privilegeExpirationInSeconds = 86400;

// Generate a combined RTC + RTM token
const token = RtcTokenBuilder.buildTokenWithRtm(
  appId,
  appCertificate,
  channelName,
  agentUid,
  RtcRole.PUBLISHER,
  tokenExpirationInSeconds,
  privilegeExpirationInSeconds
);

// Use the token to start a Conversational AI agent
const data = JSON.stringify({
  name: '<agent_identifier>',
  pipeline_id: '<your_agents_pipeline_id>',
  properties: {
    channel: channelName,
    // The token the agent uses to join the RTC channel. This is a separate
    // token from the Authorization header token, but in most cases the same
    // value can be used for both.
    token: token,
    agent_rtc_uid: agentUid,
    remote_rtc_uids: ['<remote_user_uid>'],
    enable_string_uid: false,
  },
});

const options = {
  hostname: 'api.agora.io',
  path: `/api/conversational-ai-agent/v2/projects/${appId}/join`,
  method: 'POST',
  headers: {
    'Authorization': 'agora token=' + token,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};

const req = https.request(options, (res) => {
  console.log(`Status code: ${res.statusCode}`);
  res.on('data', (d) => { process.stdout.write(d); });
});

req.on('error', (error) => { console.error(error); });
req.write(data);
req.end();
```

To use string UIDs, pass a string value for `agentUid` and set `enable_string_uid` to `true` in the request body accordingly.

**Golang**
```go
package main

import (
	"bytes"
	"fmt"
	"net/http"

	rtctokenbuilder "github.com/AgoraIO/Tools/DynamicKey/AgoraDynamicKey/go/src/rtctokenbuilder2"
)

func main() {
	// App credentials. Keep these on the server and never expose them to clients
	appId := "<your_app_id>"
	appCertificate := "<your_app_certificate>"

	// Token parameters. channelName must match properties.channel in the request body
	channelName := "<your_channel_name>"
	agentUid := "<your_agent_uid>"              // Must match agent_rtc_uid in the request body
	tokenExpirationInSeconds := uint32(86400)   // Valid range: 1–86400 (24 hours maximum)
	privilegeExpirationInSeconds := uint32(86400)

	// Generate a combined RTC + RTM token
	token, err := rtctokenbuilder.BuildTokenWithRtm(
		appId,
		appCertificate,
		channelName,
		agentUid,
		rtctokenbuilder.RolePublisher,
		tokenExpirationInSeconds,
		privilegeExpirationInSeconds,
	)
	if err != nil {
		fmt.Printf("Failed to generate token: %v\n", err)
		return
	}

	// Use the token to start a Conversational AI agent
	body := fmt.Sprintf(`{
  "name": "<agent_identifier>",
  "pipeline_id": "<your_agents_pipeline_id>",
  "properties": {
    "channel": "%s",
    "token": "%s",
    "agent_rtc_uid": "%s",
    "remote_rtc_uids": ["<remote_user_uid>"],
    "enable_string_uid": false
  }
}`, channelName, token, agentUid)

	url := fmt.Sprintf("https://api.agora.io/api/conversational-ai-agent/v2/projects/%s/join", appId)

	req, err := http.NewRequest("POST", url, bytes.NewBufferString(body))
	if err != nil {
		fmt.Printf("Failed to create request: %v\n", err)
		return
	}

	req.Header.Set("Authorization", "agora token="+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Request failed: %v\n", err)
		return
	}
	defer resp.Body.Close()

	fmt.Printf("Status code: %d\n", resp.StatusCode)
}
```

To use string UIDs, pass a string value for `agentUid` and set `enable_string_uid` to `true` in the request body.

**Python**
```python
import json
import http.client
from RtcTokenBuilder2 import RtcTokenBuilder, Role_Publisher

# App credentials. Keep these on the server and never expose them to clients
app_id = '<your_app_id>'
app_certificate = '<your_app_certificate>'

# Token parameters. channel_name must match properties.channel in the request body
channel_name = '<your_channel_name>'
agent_uid = '<your_agent_uid>'            # Must match agent_rtc_uid in the request body
token_expiration_in_seconds = 86400       # Valid range: 1–86400 (24 hours maximum)
privilege_expiration_in_seconds = 86400

# Generate a combined RTC + RTM token
token = RtcTokenBuilder.build_token_with_rtm(
    app_id,
    app_certificate,
    channel_name,
    agent_uid,
    Role_Publisher,
    token_expiration_in_seconds,
    privilege_expiration_in_seconds,
)

# Use the token to start a Conversational AI agent
payload = json.dumps({
    'name': '<agent_identifier>',
    'pipeline_id': '<your_agents_pipeline_id>',
    'properties': {
        'channel': channel_name,
        # The token the agent uses to join the RTC channel. This is a separate
        # token from the Authorization header token, but in most cases the same
        # value can be used for both.
        'token': token,
        'agent_rtc_uid': agent_uid,
        'remote_rtc_uids': ['<remote_user_uid>'],
        'enable_string_uid': False,
    }
})

headers = {
    'Authorization': 'agora token=' + token,
    'Content-Type': 'application/json'
}

conn = http.client.HTTPSConnection('api.agora.io')
conn.request(
    'POST',
    f'/api/conversational-ai-agent/v2/projects/{app_id}/join',
    payload,
    headers
)

res = conn.getresponse()
print(f'Status code: {res.status}')
print(res.read().decode('utf-8'))
```

To use string UIDs, pass a string value for `agent_uid` and set `enable_string_uid` to `True` in the request body accordingly.


### Additional considerations

- **Token expiry**: Tokens expire after a maximum of 86400 seconds (24 hours). Generate a fresh token for each agent session.
- **Two tokens**: The `Authorization` header token authenticates your server's REST API calls to Agora. The `properties.token` field is the token the agent uses to join the RTC channel. This is typically the same token, but must also include RTM privileges if you enable the Signaling service by setting `advanced_features.enable_rtm` to `true`. For details, see [Generate a token with RTC and Signaling privileges](https://docs-md.agora.io/en/help/integration-issues/rtc_rtm_token.md).

> ℹ️ **Info**
> Implement authentication on the server to mitigate the risk of data leakage.

## Implement basic HTTP authentication

### Generate Customer ID and Customer Secret

To generate a set of customer ID and customer secret, do the following:

1.  In [Agora Console](https://console.agora.io/v2), click **Developer Toolkit** > **RESTful API**.

    ![RESTful API](https://docs-md.agora.io/images/common/console-restful-api.png)

2.  Click **Add a secret**, and click **OK**. A set of customer ID and customer secret is generated.

3.  Click **Download** in the **Customer Secret** column. Read the pop-up window carefully, and save the downloaded `key_and_secret.txt` file in a secure location.

4.  Use the customer ID (key) and customer secret (secret) to generate a Base64-encoded credential, and pass the Base64-encoded credential to the `Authorization` parameter in the HTTP request header.

You can download the customer secret from Agora Console only once. Be sure to keep it secure.

### Generate an authorization header using a third-party tool

For testing and debugging, you can use a [third-party online tool](https://www.debugbear.com/basic-auth-header-generator) to quickly generate your Authorization header. Enter your Customer ID as the Username and your Customer Secret as the Password. Your generated header should look like this::

```
Authorization: Basic NDI1OTQ3N2I4MzYy...YwZjA=a
```

### Basic authentication sample code

The following sample code implements basic HTTP authentication and sends a RESTful API request to get the basic information of all your current Agora projects.

> ⚠️ **Caution**
> The Agora RESTful API only supports HTTPS with TLS 1.0, 1.1, or 1.2 for encrypted communication. Requests over plain HTTP are not supported and will fail to connect.

**Golang**
```go
package main

import (
  "fmt"
  "strings"
  "net/http"
  "io/ioutil"
  "encoding/base64"
)

// HTTPS basic authentication example in Golang using the Video SDK Server RESTful API
func main() {

  // Customer ID
  customerKey := "Your customer ID"
  // Customer secret
  customerSecret := "Your customer secret"

  // Concatenate customer key and customer secret and use base64 to encode the concatenated string
  plainCredentials := customerKey + ":" + customerSecret
  base64Credentials := base64.StdEncoding.EncodeToString([]byte(plainCredentials))

  url := "https://api.agora.io/dev/v1/projects"
  method := "GET"

  payload := strings.NewReader(``)

  client := &http.Client {
  }
  req, err := http.NewRequest(method, url, payload)

  if err != nil {
    fmt.Println(err)
    return
  }
  // Add Authorization header
  req.Header.Add("Authorization", "Basic " + base64Credentials)
  req.Header.Add("Content-Type", "application/json")

  // Send HTTP request
  res, err := client.Do(req)
  if err != nil {
    fmt.Println(err)
    return
  }
  defer res.Body.Close()

  body, err := ioutil.ReadAll(res.Body)
  if err != nil {
    fmt.Println(err)
    return
  }
  fmt.Println(string(body))
}
```

**Node.js**
```js
// HTTP basic authentication example in node.js using the Video SDK Server RESTful API
const https = require('https')
// Customer ID
const customerKey = "Your customer ID"
// Customer secret
const customerSecret = "Your customer secret"
// Concatenate customer key and customer secret and use base64 to encode the concatenated string
const plainCredential = customerKey + ":" + customerSecret
// Encode with base64
encodedCredential = Buffer.from(plainCredential).toString('base64')
authorizationField = "Basic " + encodedCredential

// Set request parameters
const options = {
  hostname: 'api.agora.io',
  port: 443,
  path: '/dev/v1/projects',
  method: 'GET',
  headers: {
    'Authorization':authorizationField,
    'Content-Type': 'application/json'
  }
}

// Create request object and send request
const req = https.request(options, res => {
  console.log(`Status code: \${res.statusCode}`)

  res.on('data', d => {
    process.stdout.write(d)
  })
})

req.on('error', error => {
  console.error(error)
})

req.end()
```

**PHP**
```php
<?php
// HTTP basic authentication example in PHP using the Agora Server RESTful API

// Customer ID and secret
$customerKey = "Your customer ID";   // Replace with your actual customer ID
$customerSecret = "Your customer secret"; // Replace with your actual customer secret

// Concatenate customer key and customer secret
$credentials = $customerKey . ":" . $customerSecret;

// Encode with base64
$base64Credentials = base64_encode($credentials);

// Create authorization header
$authHeader = "Authorization: Basic " . $base64Credentials;

// Initialize cURL
$curl = curl_init();

// Set cURL options
curl_setopt_array($curl, [
    CURLOPT_URL => 'https://api.agora.io/dev/v1/projects',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_ENCODING => '',
    CURLOPT_MAXREDIRS => 10,
    CURLOPT_TIMEOUT => 0,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_CUSTOMREQUEST => 'GET',
    CURLOPT_HTTPHEADER => [
        $authHeader,
        'Content-Type: application/json',
    ],
]);

// Execute cURL request
$response = curl_exec($curl);

// Check for cURL errors
if ($response === false) {
    echo "Error in cURL: " . curl_error($curl);
} else {
    // Output the response
    echo $response;
}

// Close cURL session
curl_close($curl);
?>
```

**Python**
```python
# -- coding utf-8 --
# Python 3
# HTTP basic authentication example in python using the Video SDK Server RESTful API
import base64
import http.client

# Customer ID
customer_key = "Your customer ID"
# Customer secret
customer_secret = "Your customer secret"

# Concatenate customer key and customer secret and use base64 to encode the concatenated string
credentials = customer_key + ":" + customer_secret
# Encode with base64
base64_credentials = base64.b64encode(credentials.encode("utf8"))
credential = base64_credentials.decode("utf8")

# Create connection object with basic URL
conn = http.client.HTTPSConnection("api.agora.io")

payload = ""

# Create Header object
headers = {}
# Add Authorization field
headers['Authorization'] = 'basic ' + credential

headers['Content-Type'] = 'application/json'

# Send request
conn.request("GET", "/dev/v1/projects", payload, headers)
res = conn.getresponse()
data = res.read()
print(data.decode("utf-8"))
```

**Java**
```java
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Base64;

// HTTP basic authentication example in Java using the Video SDK Server RESTful API
public class Base64Encoding {

    public static void main(String[] args) throws IOException, InterruptedException {

        // Customer ID
        final String customerKey = "Your customer ID";
        // Customer secret
        final String customerSecret = "Your customer secret";

        // Concatenate customer key and customer secret and use base64 to encode the concatenated string
        String plainCredentials = customerKey + ":" + customerSecret;
        String base64Credentials = new String(Base64.getEncoder().encode(plainCredentials.getBytes()));
        // Create authorization header
        String authorizationHeader = "Basic " + base64Credentials;

        HttpClient client = HttpClient.newHttpClient();

        // Create HTTP request object
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.agora.io/dev/v1/projects"))
                .GET()
                .header("Authorization", authorizationHeader)
                .header("Content-Type", "application/json")
                .build();
        // Send HTTP request
        HttpResponse<String> response = client.send(request,
                HttpResponse.BodyHandlers.ofString());

        System.out.println(response.body());
    }
}
```

**C#**
```csharp
using System;
using System.IO;
using System.Net;
using System.Text;

// HTTP basic authentication example in C# using the Video SDK Server RESTful API
namespace Examples.System.Net
{
    public class WebRequestPostExample
    {
        public static void Main()
        {
            // Customer ID
            string customerKey = "Your customer ID";
            // Customer secret
            string customerSecret = "Your customer secret";
            // Concatenate customer key and customer secret and use base64 to encode the concatenated string
            string plainCredential = customerKey + ":" + customerSecret;

            // Encode with base64
            var plainTextBytes = Encoding.UTF8.GetBytes(plainCredential);
            string encodedCredential = Convert.ToBase64String(plainTextBytes);
            // Create authorization header
            string authorizationHeader = "Authorization: Basic " + encodedCredential;

            // Create request object
            WebRequest request = WebRequest.Create("https://api.agora.io/dev/v1/projects");
            request.Method = "GET";

            // Add authorization header
            request.Headers.Add(authorizationHeader);
            request.ContentType = "application/json";

            WebResponse response = request.GetResponse();
            Console.WriteLine(((HttpWebResponse)response).StatusDescription);

            using (Stream dataStream = response.GetResponseStream())
            {
                StreamReader reader = new StreamReader(dataStream);
                string responseFromServer = reader.ReadToEnd();
                Console.WriteLine(responseFromServer);
            }

            response.Close();
        }
    }
}
```


----

---
title: Start a conversational AI agent
description: Create and start a Conversational AI agent instance.
sidebar_position: 1
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/join
exported_on: '2026-05-01T05:34:26.767423Z'
exported_file: join.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/join)

# Start a conversational AI agent


**Method:** POST
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/join`

Use this endpoint to create and start a Conversational AI agent instance.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
### Request body

APPLICATION/JSON
**BODY**

- **name** (string): The unique identifier of the agent. The same identifier cannot be used repeatedly.
- **preset** (string): A comma-separated string of one or more presets. Each preset provides a predefined configuration for ASR, LLM, and TTS. You can specify a preset for any or all of ASR, LLM, and TTS. When a preset is specified, you do not need to provide the endpoint URL, API key, or model for the preset providers. Use the `asr`, `llm`, and `tts` fields to configure additional settings.Available presets- **ASR**
      - [deepgram_nova_2](https://docs-md.agora.io/en/conversational-ai/models/asr/deepgram.md)
      - [deepgram_nova_3](https://docs-md.agora.io/en/conversational-ai/models/asr/deepgram.md)
    - **LLM**
      - [openai_gpt_4o_mini](https://docs-md.agora.io/en/conversational-ai/models/llm/openai.md)
      - [openai_gpt_4_1_mini](https://docs-md.agora.io/en/conversational-ai/models/llm/openai.md)
      - [openai_gpt_5_nano](https://docs-md.agora.io/en/conversational-ai/models/llm/openai.md)
      - [openai_gpt_5_mini](https://docs-md.agora.io/en/conversational-ai/models/llm/openai.md)
    - **TTS**
      - [minimax_speech_2_6_turbo](https://docs-md.agora.io/en/conversational-ai/models/tts/minimax.md)
      - [minimax_speech_2_8_turbo](https://docs-md.agora.io/en/conversational-ai/models/tts/minimax.md)
      - [openai_tts_1](https://docs-md.agora.io/en/conversational-ai/models/tts/openai.md)
- **pipeline_id** (string): The unique ID of a published agent in [Agent Studio](https://docs-md.agora.io/en/conversational-ai/studio/overview.md). When provided, the saved agent configuration is used as the base configuration. Any fields specified in `properties` override the corresponding agent settings. When you specify a `pipeline_id`, the `asr`, `tts`, and `llm` fields in `properties` are optional.
- **properties** (object): Configuration details of the agent.
  - **channel** (string): The name of the channel to join.
  - **token** (string): The authentication token used by the agent to join the channel.
  - **agent_rtc_uid** (string): The user ID of the agent in the channel. All UIDs within an RTC channel must be unique. Ensure no other user or service bot is using this UID. A value of `0` means that a unique random UID is generated and assigned. Set the `token` accordingly.
  - **remote_rtc_uids** (array[string]): A list of user IDs that the agent subscribes to in the channel. Only subscribed users can interact with the agent.Currently, only one user ID is supported.
  - **enable_string_uid** (boolean): Whether to enable String uid:
    - `true`: Both agent and subscriber user IDs use strings.
    - `false`: Both agent and subscriber user IDs must be integers.
  - **idle_timeout** (integer): Sets the timeout after all the users specified in `remote_rtc_uids` are detected to have left the channel. When the timeout value is exceeded, the agent automatically stops and exits the channel. A value of `0` means that the agent does not exit until it is stopped manually.For precise and reliable control over the agent's lifecycle, use the [`leave`](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/leave.md) API to terminate the agent as soon as its task is complete.
  - **geofence** (string): Regional access restriction configuration. Use this to limit which Agora servers the Conversational AI Engine can access based on geographic regions.
    - **area** (string, possible values: `GLOBAL`, `NORTH_AMERICA`, `EUROPE`, `ASIA`, `INDIA`, `JAPAN`): The allowed region for server access.
    - **exclude_area** (string, possible values: `NORTH_AMERICA`, `EUROPE`, `ASIA`, `INDIA`, `JAPAN`): The excluded region. Only available when `area` is set to `GLOBAL`.
  - **advanced_features** (object): Advanced features configuration.
    - **enable_mllm** (boolean): Use [mllm.enable](#properties-mllm-enable) instead.

        Enable Multimodal Large Language Model for voice-to-voice processing. Enabling MLLM automatically disables ASR, LLM, and TTS since the MLLM handles end-to-end voice processing directly. See `turn_detection.type` for turn detection options available with MLLM.
    - **enable_rtm** (boolean): Whether to enable the Signaling (RTM) service. When enabled, the agent can combine the capabilities provided by Signaling to implement advanced functions, such as delivering [custom information](https://docs-md.agora.io/en/conversational-ai/develop/custom-information.md).Before enabling the Signaling service, make sure the token includes both RTC and RTM privileges. When an agent joins an RTM channel, it reuses the token specified in the `token` field. For more information, see ["How can I generate a token with both RTC and Signaling privileges?"](https://docs-md.agora.io/en/help/integration-issues/rtc_rtm_token.md).
    - **enable_sal** (boolean): Enable Selective Attention Locking (SAL). When enabled, configure the `sal` field to set up speaker recognition or locking modes. See the `sal` parameter for configuration details.
    - **enable_tools** (boolean): Enable tool invocation. When enabled, the agent can invoke tools provided by the MCP server to implement advanced functionality.
  - **asr** (object): Automatic Speech Recognition (ASR) configuration.
    - **language** (string): The BCP-47 language tag identifying the primary language used for agent interaction. If `params` contains a vendor-specific language code, it takes precedence over this setting.
    - **vendor** (string, possible values: `ares`, `microsoft`, `deepgram`, `openai`, `google`, `amazon`, `assemblyai`, `sarvam`): ASR provider:
      - `ares`: [Adaptive Recognition Engine for Speech](https://docs-md.agora.io/en/conversational-ai/models/asr/ares.md)
      - `microsoft`: [Microsoft Azure](https://docs-md.agora.io/en/conversational-ai/models/asr/microsoft.md)
      - `deepgram`: [Deepgram](https://docs-md.agora.io/en/conversational-ai/models/asr/deepgram.md)
      - `openai`: [OpenAI (Beta)](https://docs-md.agora.io/en/conversational-ai/models/asr/openai.md)
      - `speechmatics`: [Speechmatics](https://docs-md.agora.io/en/conversational-ai/models/asr/speechmatics.md)
      - `assemblyai`: [AssemblyAI (Beta)](https://docs-md.agora.io/en/conversational-ai/models/asr/assembly-ai.md)
      - `amazon`: [Amazon Transcribe (Beta)](https://docs-md.agora.io/en/conversational-ai/models/asr/amazon.md)
      - `google`: [Google (Beta)](https://docs-md.agora.io/en/conversational-ai/models/asr/google.md)
      - `sarvam`: [Sarvam (Beta)](https://docs-md.agora.io/en/conversational-ai/models/asr/sarvam.md)
    - **params** (object): The configuration parameters for the ASR vendor. See [ASR Overview](https://docs-md.agora.io/en/conversational-ai/models/asr/overview.md) for details.
  - **tts** (object): Text-to-speech (TTS) module configuration.
    - **vendor** (string, possible values: `microsoft`, `elevenlabs`, `minimax`, `deepgram`, `cartesia`, `openai`, `humeai`, `rime`, `fishaudio`, `google`, `amazon`, `sarvam`): TTS provider. 
        - `microsoft`: [Microsoft Azure](https://docs-md.agora.io/en/conversational-ai/models/tts/microsoft.md)
        - `elevenlabs`: [ElevenLabs](https://docs-md.agora.io/en/conversational-ai/models/tts/elevenlabs.md)
        - `minimax`: [MiniMax](https://docs-md.agora.io/en/conversational-ai/models/tts/minimax.md)
        - `deepgram`: [Deepgram (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/deepgram.md)
        - `murf`: [Murf (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/murf.md)
        - `cartesia` : [Cartesia (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/cartesia.md)
        - `openai`: [OpenAI (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/openai.md)
        - `humeai`: [Hume AI (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/humeai.md)
        - `rime`: [Rime (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/rime.md)
        - `fishaudio`: [Fish Audio (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/fish-audio.md)
        - `google`: [Google (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/google.md)
        - `amazon`: [Amazon Polly (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/amazon.md)
        - `sarvam`: [Sarvam (Beta)](https://docs-md.agora.io/en/conversational-ai/models/tts/sarvam.md)
    - **params** (object): The configuration parameters for the TTS vendor. See [TTS Overview](https://docs-md.agora.io/en/conversational-ai/models/tts/overview.md) for details.
    - **skip_patterns** (array[integer]): Controls whether the TTS module skips bracketed content when reading LLM response text. This prevents the agent from vocalizing structural prompt information like tone indicators, action descriptions, and system prompts, creating a more natural and immersive listening experience. Enable this feature by specifying one or more values:
        
        - `1`: Skip content in Chinese parentheses `（）`
        - `2`: Skip content in Chinese square brackets `【】`
        - `3`: Skip content in parentheses `( )`
        - `4`: Skip content in square brackets `[ ]`
        - `5`: Skip content in curly braces `{ }`- **Nested brackets**: When input text contains nested brackets and multiple bracket types are configured to be skipped, the system processes only the outermost brackets. The system matches from the beginning of the text and skips the first outermost bracket pair that meets the skip rule, including all nested content.
        - **Agent memory**: The agent's short-term memory always contains the complete, unfiltered LLM text, regardless of live captioning settings.
        - **Real-time transcript**: When enabled, transcript excludes filtered content during TTS playback but restores the complete text after each sentence finishes.
  - **llm** (object): Large language model (LLM) configuration.
    - **url** (string): The LLM callback address.
    - **api_key** (string): The LLM verification API key. The default value is an empty string. Ensure that you enable the API key in a production environment.
    - **system_messages** (array[object]): A set of predefined information used as input to the LLM, including prompt words and examples.
    - **params** (object): Additional LLM configuration parameters, such as the `model` used, and the maximum token limit. For details about each supported LLM, refer to [Supported LLMs](https://docs-md.agora.io/en/conversational-ai/models/llm/overview.md).
    - **max_history** (integer, possible values: `[1`, `1024]`): The number of conversation history messages cached in the LLM. History includes user and agent dialog messages, tool call information, and timestamps. Agent and user messages are recorded separately.
    - **input_modalities** (array[string]): LLM input modalities: 
        - `["text"]`: Text only
        - `["text", "image"]`: Text plus image; requires the selected LLM to support visual input
    - **output_modalities** (array[string]): LLM output modalities: 
        - `["text"]`: The output text is converted to speech by the TTS module and then published to the RTC channel.
        - `["audio"]`: Voice only. Voice is published directly to the RTC channel.
        - `["text", "audio"]`: Text plus voice. Write your own logic to process the output of LLM as needed.
    - **greeting_configs** (object): Agent greeting broadcast configuration.
      - **mode** (string, possible values: `single_every`, `single_first`): Determines when the agent sends greeting messages to users joining the channel.

            - `single_every`: Broadcasts a greeting every time a user joins the channel.
            - `single_first`: Broadcasts a greeting only once to the first user who joins the channel.
      - **delay_ms** (integer, possible values: `[0`, `5000]`): The delay in milliseconds before the agent plays the greeting message after a user joins the channel.
    - **greeting_message** (string): Agent greeting. If provided, the first user in the channel is automatically greeted with the message upon joining.
    - **failure_message** (string): Prompt for agent activation failure. If provided, it is returned through TTS when the custom LLM call fails.
    - **vendor** (string): LLM provider, supports the following settings:
        - `custom`: Custom LLM. When you set this option, the agent includes the following fields, in addition to `role` and `content` when making requests to the custom LLM:
          - `turn_id`: A unique identifier for each conversation turn. It starts from `0` and increments with each turn. One user-agent interaction corresponds to one `turn_id`.
          - `timestamp`: The request timestamp, in milliseconds.
        - `azure`: Use this value for Azure OpenAI
    - **style** (string, possible values: `openai`, `gemini`, `anthropic`, `dify`): The request style for chat completion:
        - `openai`: For OpenAI and OpenAI-compatible APIs
        - `gemini`: For Google Gemini and Google Vertex API format
        - `anthropic`: For Anthropic Claude API format
        - `dify`: For Dify API format

        For details, refer to [Supported LLMs](https://docs-md.agora.io/en/conversational-ai/models/llm/overview.md).
    - **template_variables** (object): Template parameter configuration used to insert variables into the agent's `system_messages`, `greeting_message`, `failure_message`, and `parameters.silence_config.content` text. Uses key-value pairs, where the key is the variable name and the value is the variable's value. Template variables, combined with prompt customization and SIP outbound calling functionality, enable dynamic content injection, automating processes such as automatic hang-up, voicemail recognition, automatic message leaving, and call transfer.

        To insert defined variables in the prompt text, use the syntax `{{variable_name}}`. The system automatically replaces each variable with the corresponding value defined in `template_variables`.Variable values cannot reference other variables. For example, if you define `"farewell": "Looking forward to seeing you again, {{name}}"`, the `{{name}}` variable will not be resolved.
    - **mcp_servers** (array): MCP (Model Context Protocol) server configuration. By configuring MCP servers, agents can call tools provided by external services to implement advanced functionality.
      - **name** (string): A unique identifier for the MCP server. Maximum 48 characters. Accepts only English letters and numbers.
      - **endpoint** (string): The endpoint address of the MCP server. The agent uses this to communicate with the MCP server.
      - **transport** (string, possible values: `streamable_http`): Transport protocol type. 
          - `streamable_http`: Streaming HTTP protocol
      - **headers** (object): HTTP header information to include when requesting the MCP server, such as authentication information.
      - **allowed_tools** (array): A list of tools that the agent is allowed to invoke. The agent can only use tools on this list.
          
          **Behavior:**
          - **Empty or omitted**: All tools are enabled.
          - **Empty array `[]`**: No tools are enabled.
          - **`["*"]`**: All tools are enabled.
          - **Specific tools `["aa", "bb", "cc"]`**: Only `aa`, `bb`, and `cc` are enabled.
          - **Mix with wildcard `["aa", "bb", "*"]`**: All tools are enabled (wildcard takes precedence).
      - **timeout_ms** (integer): The MCP server request timeout in milliseconds. After timeout, the agent stops waiting for the MCP server's response and continues executing subsequent logic.
    - **headers** (object): Custom headers to include in requests to the LLM. Use this field to pass business-specific information such as custom fields or tenant identifiers.- These headers are merged with the headers generated by the Conversational AI Engine. If a key conflict occurs, the engine-generated header takes precedence. For example, authentication-related headers.
        - Header keys are merged using exact string matching and are case-sensitive. Agora recommends using standard capitalization to avoid ambiguity from duplicate keys with different casing.
  - **mllm** (object): Multimodal Large Language Model (MLLM) configuration for real-time audio and text processing. `mllm` is an exclusive alternative to the standard `asr` + `llm` + `tts` pipeline."
    - **enable** (boolean): Enable Multimodal Large Language Model for voice-to-voice processing. Enabling MLLM automatically disables ASR, LLM, and TTS since the MLLM handles end-to-end voice processing directly. Replaces the deprecated `advanced_features.enable_mllm`.
    - **url** (string): The MLLM WebSocket URL for real-time communication.
    - **api_key** (string): The API key used for MLLM authentication.
    - **messages** (array[object]): Array of conversation items used for short-term memory management. Uses the same structure as `item.content` from theOpenAI Realtime API.
    - **params** (object): Additional MLLM configuration parameters.
        - **Modalities override**: The `modalities` setting in params is overridden by `input_modalities` and `output_modalities`.
        - **Turn detection override**: The `turn_detection` setting in `params` is overridden by `mllm.turn_detection`.

        See [MLLM Overview](https://docs-md.agora.io/en/conversational-ai/models/mllm/overview.md) for details.
    - **input_modalities** (array[string]): MLLM input modalities:
        - `["audio"]`: Audio only
        - `["audio", "text"]`: Audio plus text
    - **output_modalities** (array[string]): MLLM output modalities:
        - `["text", "audio"]`: Text plus audio
    - **greeting_message** (string): Agent greeting message. If provided, the first user in the channel is automatically greeted with this message upon joining.
    - **vendor** (string, possible values: `openai`, `gemini`, `vertexai`): MLLM provider. Currently supports:
        - `openai`: [OpenAI Realtime API](https://docs-md.agora.io/en/conversational-ai/models/mllm/openai.md)
        - `gemini`: [Google Gemini Live](https://docs-md.agora.io/en/conversational-ai/models/mllm/gemini.md)
        - `vertexai`: [Google Gemini Live (Vertex AI)](https://docs-md.agora.io/en/conversational-ai/models/mllm/google-vertex-ai.md)
    - **turn_detection** (object): Turn detection configuration for the MLLM module.When `mllm.turn_detection` is defined, the top-level `turn_detection` object has no effect.
      - **mode** (string, possible values: `agora_vad`, `server_vad`, `semantic_vad`): - `agora_vad`: Agora VAD-based detection. 
          - `server_vad`: Vendor-side VAD-based detection. Supported by OpenAI Realtime API and Gemini Live.
          - `semantic_vad`: Semantic-based detection. Supported by OpenAI Realtime API only.
      - **agora_vad_config** (object): Configuration for Agora VAD-based turn detection. Applicable when `mode` is `agora_vad`.
        - **interrupt_duration_ms** (integer): Minimum duration of speech in milliseconds required to trigger an interruption.
        - **prefix_padding_ms** (integer): Duration of audio in milliseconds to include before the detected speech start.
        - **silence_duration_ms** (integer): Duration of silence in milliseconds required to determine end of speech.
        - **threshold** (number): VAD sensitivity threshold. A higher value reduces false positives.
      - **server_vad_config** (object): Configuration for vendor-side VAD-based turn detection. Applicable when `mode` is `server_vad`. Parameters are passed through to the vendor.
        - **prefix_padding_ms** (integer): Duration of audio in milliseconds to include before the detected speech start.
        - **silence_duration_ms** (integer): Duration of silence in milliseconds required to determine end of speech.
        - **threshold** (number): VAD sensitivity threshold. Applicable to OpenAI Realtime API only.
        - **idle_timeout_ms** (integer): Idle timeout in milliseconds. Applicable to OpenAI Realtime API only.
        - **start_of_speech_sensitivity** (string, possible values: `START_SENSITIVITY_HIGH`, `START_SENSITIVITY_LOW`): Sensitivity for start of speech detection. Applicable to Gemini Live only.
        - **end_of_speech_sensitivity** (string, possible values: `END_SENSITIVITY_HIGH`, `END_SENSITIVITY_LOW`): Sensitivity for end of speech detection. Applicable to Gemini Live only.
      - **semantic_vad_config** (object): Configuration for semantic-based turn detection. Applicable when `mode` is `semantic_vad`. Supported by OpenAI Realtime API only.
        - **eagerness** (string, possible values: `auto`, `low`, `medium`, `high`): Controls how eagerly the model ends its turn.
  - **avatar** (object): Avatar configuration.
    - **enable** (boolean): Whether to enable the avatar function for the agent. To enable, set to `true` and configure the `vendor` and `params` fields.
    - **vendor** (string, possible values: `akool`, `liveavatar`, `anam`): Avatar vendor. Supports the following values:  
        - `akool`: [Akool (Beta)](https://docs-md.agora.io/en/conversational-ai/models/avatar/akool.md)
        - `liveavatar`: [LiveAvatar (Beta)](https://docs-md.agora.io/en/conversational-ai/models/avatar/heygen.md)
        - `anam`: [Anam (Beta)](https://docs-md.agora.io/en/conversational-ai/models/avatar/anam.md)
    - **params** (object): The configuration parameters for the avatar vendor. See [AI Avatar Overview](https://docs-md.agora.io/en/conversational-ai/models/avatar/overview.md) for details.
  - **turn_detection** (object): Conversation turn detection settings. Controls the logic for voice activity detection and conversation turn determination. The previous version of `turn_detection` is deprecated. Refer to [Deprecated parameters](#deprecated-parameters) for details. Agora recommends switching to the latest parameters.This object has no effect when `mllm.enable` is true. Use [mllm.turn_detection](#properties-mllm-turn-detection) instead.Starting with v2.6, `turn_detection` only handles Start of Speech (SoS) and End of Speech (EoS) detection. Interruption handling strategies, including keyword-based interruption and disabling interruption, have moved to the top-level [`interruption`](#properties-interruption) field.This configuration supports multiple combinations of detection modes:
      - **Start of Speech (SoS)**: Supports three modes: VAD, Keyword, and Disable.
      - **End of Speech (EoS)**: Supports VAD and Semantic modes.
    - **mode** (string, possible values: `default`): Conversation turn detection mode:
        - `default`: Uses standard conversation turn detection configuration.
    - **config** (object): Detailed configuration for conversation turn detection.
      - **speech_threshold** (number, possible values: `(0.0`, `1.0)`): Voice activity detection sensitivity. Determines the sound level in the audio signal that is considered voice activity. Lower values make it easier for the agent to detect speech, and higher values ignore weak sounds.
      - **start_of_speech** (object): Start of Speech (SoS) detection configuration. Determines when a user begins speaking.
        - **mode** (string, possible values: `vad`, `keywords`, `disabled`): Start of speech detection mode:
          - `vad`: Based on VAD (Voice Activity Detection). Uses audio signal detection.
          - `keywords`: Deprecated. Use [`interruption.mode = "keywords"`](#properties-interruption-mode) instead.
          - `disabled`: Deprecated. Use [`interruption.enable = false`](#properties-interruption-enable) with [`interruption.disabled_config.strategy`](#properties-interruption-disabled-config-strategy) to configure the handling strategy.
        - **{mode}_config** (object): Start of speech detection configuration parameters. The structure and supported fields vary depending on the detection mode.- The configuration type must match `mode`. For example, when `mode` is `vad`, you must provide `vad_config`.
            - You cannot provide multiple mode configurations simultaneously.**Configuration examples:**
            
            - `vad_config`

              ```json
              "vad_config": {
                "interrupt_duration_ms": 160,
                "speaking_interrupt_duration_ms": 160,
                "prefix_padding_ms": 800
              }
              ```

            - `keywords_config`

              ```json
              "keywords_config": {
                "interrupt_duration_ms": 160,
                "prefix_padding_ms": 800,
                "triggered_keywords": ["Are you there", "hello"]
              }       
              ```

            - `disabled_config`

              ```json
              "disabled_config": {
                  "strategy": "append"
              }              
              ```
          - **interrupt_duration_ms** (integer, possible values: `[120`, `1200]`): The amount of time in milliseconds that the user's voice must exceed the VAD threshold before an interruption is triggered.
          - **speaking_interrupt_duration_ms** (integer, possible values: `[120`, `1200]`): Interruption duration in milliseconds while the agent is speaking.
          - **prefix_padding_ms** (integer, possible values: `[0`, `5000]`): The extra forward padding time in milliseconds before the processing system starts to process the speech input. This padding helps capture the beginning of speech.
          - **triggered_keywords** (array[string]): Specifies the list of keywords that trigger an interruption. When the agent detects any of these keywords in the user's speech, it immediately stops its current interaction and processes the new input.
          - **strategy** (string, possible values: `append`, `ignore`): Voice processing strategy when the agent is interacting (speaking or thinking):
              - `append`: Append mode. Human voice does not interrupt the agent. The agent processes the human voice input after the current interaction ends.
              - `ignore`: Ignore mode. The agent ignores human voice input. If the agent receives human voice while speaking or thinking, the agent discards the input without storing it in context.
      - **end_of_speech** (object): End of Speech (EoS) detection configuration. Determines when a user ends their speech.
        - **mode** (string, possible values: `vad`, `semantic`): End of speech detection mode. Possible values:
            - `vad`: Based on VAD (Voice Activity Detection). Detects silence duration.
            - `semantic`: Based on semantic triggering. Uses semantic understanding to determine when conversation ends.When `mode` is `semantic`, EOS detection supports English and Chinese only. For unsupported languages, the engine falls back to VAD.
        - **{mode}_config** (object): End of speech detection configuration parameters. The structure and supported fields vary depending on the detection mode.- The configuration type must match `mode`. For example, when `mode` is `vad`, you must provide `vad_config`.
            - You cannot provide multiple mode configurations simultaneously.**Configuration examples:**

            - `vad_config`

              ```json
              "vad_config": {
                "silence_duration_ms": 640
              }
              ```
            
            - `semantic_config`

              ```json
              "semantic_config": {
                  "silence_duration_ms": 320,
                  "max_wait_ms": 3000,
                  "pause_state_enabled": true
              }
              ```
          - **silence_duration_ms** (integer, possible values: `[120`, `2000]`): **Default**: `640` in `vad_config`, `320` in `semantic_config`  
              Silence duration threshold in milliseconds. The minimum silence duration at the end of a speech segment,  to ensure that a brief pause does not prematurely end the speech segment.
          - **max_wait_ms** (integer, possible values: `[500`, `10000]`): `-1` means forever.  

              Maximum wait time in milliseconds. The maximum time to wait for semantic determination. After timeout, the conversation end is determined based on the current state.
          - **pause_state_enabled** (boolean): Whether to detect user intent to pause the conversation:
              - `true`: The agent uses semantic understanding to determine if the user intends to pause the conversation. For example, when the user's input ends with phrases such as "hold on" or "just a moment", the agent waits for further input rather than treating the utterance as complete and sending it to the LLM.
              - `false`: The agent does not detect intent to pause the conversation.
  - **interruption** (object): Interruption control configuration. Provides unified management of the agent's behavior when interrupted by the user.
    - **enable** (boolean): Whether to enable agent interruption:
        - `true`: Enable interruption.
        - `false`: Disable interruption. When disabled, the agent cannot be interrupted mid-response.
    - **mode** (string, possible values: `start_of_speech`, `keywords`): The interruption trigger mode:
        - `start_of_speech`: Trigger interruption when the user starts speaking.
        - `keywords`: Trigger interruption when the user speaks a specified keyword. Configure the trigger keywords in `keywords_config`.
    - **keywords_config** (object): Configuration for keyword-based interruption triggering. Applicable only when `mode` is `keywords`.
      - **trigger_keywords** (array[string]): The list of keywords that trigger an interruption. A maximum of 128 keywords is supported.
    - **disabled_config** (object): Configuration for agent behavior when interruption is disabled. Applicable only when `interruption.enable` is `false`.
      - **strategy** (string, possible values: `append`, `ignore`): The processing strategy when interruption is disabled:
          - `append`: User speech does not interrupt the agent. The agent processes the user's input after the current interaction ends.
          - `ignore`: The agent ignores user speech. If the agent receives user speech while speaking or thinking, it discards the input without storing it in context.
  - **sal** (object): Selective Attention Locking (SAL) configuration. **(Beta)**
    - **sal_mode** (string, possible values: `locking`, `recognition`): Selective attention lock mode. Supports the following options:

        - `locking`: Speaker Lock Mode. The agent locks onto the speaker, blocking 95% of ambient human voices and noise. You can enable this mode in two ways:

          - Seamless mode: When a user speaks loudly and clearly at the beginning of a conversation, the intelligent agent automatically recognizes the user as the speaker.
          - Personalized mode: When creating an agent, a speaker's voiceprint URL is pre-registered through the `sample_urls` field. The agent then locates the speaker based on the pre-registered voiceprint.

        - `recognition`: Voiceprint recognition mode. You can pre-register only one voiceprint URL using the `sample_urls` field. The agent identifies different speakers and suppresses other background voices and environmental noise. The target speaker is identified through the `vpids` field in the `metadata` field and sent to the LLM. Set `llm.vendor` to "custom" and refer to [Custom LLM](https://docs-md.agora.io/en/conversational-ai/develop/custom-llm.md) for instructions on how to make the LLM process speaker information.
    - **sample_urls** (object): The registered voiceprint URL as a key-value pair, where the key is the voiceprint name and the value is the download URL for the speaker's voiceprint. Only one voiceprint URL is supported.  
        Example:

        ```json
        {
          "speaker1": "https://example.com/speaker1.pcm"
        }
        ```- Do not set the incoming voiceprint name to "unknown"; this is a reserved keyword used to identify unknown speakers.
          - For a registered voiceprint, ensure that:
            - Size: The voiceprint file does not exceed 2 MB.
            - Duration: Contains 10 to 15 seconds of audio, with at least 8 seconds of effective audio excluding silent segments.
            - Format: 16kHz sampling rate, 16-bit depth, mono PCM audio file. The file name extension must be ".pcm".
  - **labels** (object): Custom labels in key-value pair format, where the key is the label name and the value is the label value. Enables agents to carry custom business information.

      These labels are bound to the agent and returned in the `payload` field of all message notification callbacks from the conversational AI engine. Use them to implement custom business logic, such as tagging activity IDs, customer groups, and business scenarios.
  - **rtc** (object): RTC media encryption configuration.
    - **encryption_key** (string): The encryption key for RTC media content. The key has no length limit. Agora recommends using a 32-byte key. If no encryption key is set or if the key is empty, built-in encryption is not used.
    - **encryption_salt** (string): The salt value used for encryption. This is a Base64-encoded string that is 32 bytes long after decoding. This parameter only takes effect when `encryption_mode` is set to `7` (`AES_128_GCM2`) or `8` (`AES_256_GCM2`). Ensure that the salt parameter is not empty for these encryption modes.
    - **encryption_mode** (integer, possible values: `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`): The built-in encryption mode. 
          - `1`: `AES_128_XTS` - 128-bit AES encryption, XTS mode.
          - `2`: `AES_128_ECB` - 128-bit AES encryption, ECB mode.
          - `3`: `AES_256_XTS` - 256-bit AES encryption, XTS mode.
          - `4`: `SM4_128_ECB` - 128-bit SM4 encryption, ECB mode.
          - `5`: `AES_128_GCM` - 128-bit AES encryption, GCM mode.
          - `6`: `AES_256_GCM` - 256-bit AES encryption, GCM mode.
          - `7`: `AES_128_GCM2` - 128-bit AES encryption, GCM mode. Requires setting `encryption_salt`.
          - `8`: `AES_256_GCM2` - 256-bit AES encryption, GCM mode. Requires setting `encryption_salt`.

        Agora recommends using either `7` (`AES_128_GCM2`) or `8` (`AES_256_GCM2`) mode. Both modes support cryptographic salts to enhance security.
  - **filler_words** (object): Filler word configuration. Plays filler words while waiting for LLM responses to reduce user anxiety and improve conversation flow.
      
      Filler word playback follows these rules:
      - **Playback order**: When multiple filler words or LLM responses are waiting to be played, they are played in the order they arrive.
      - **Interruption control**: Inherits the interruption mode setting from the [`interruption`](#properties-interruption) field.
    - **enable** (boolean): Whether to enable filler words:
        - `true`: Enable filler words.
        - `false`: Disable filler words.
    - **trigger** (object): Filler word trigger configuration. Defines when to trigger filler word playback.
      - **mode** (string, possible values: `fixed_time`): Filler word trigger mode:
          - `fixed_time`: Fixed time trigger. Triggers filler word playback when LLM response wait time exceeds the threshold.
      - **{mode}_config** (object): Filler word trigger configuration parameters. The parameter name and structure vary depending on the trigger mode.- The configuration type must match `mode`. For example, when `mode` is `fixed_time`, you must provide `fixed_time_config`.
          - You cannot provide multiple mode configurations simultaneously.**Configuration example:**           

          ```json
          "fixed_time_config": {
            "response_wait_ms": 1500
          }
          ```
        - **response_wait_ms** (integer, possible values: `[100`, `10000]`): LLM response wait threshold in milliseconds. Triggers filler word playback when the LLM waits this duration without generating a response, such as when waiting for RAG retrieval or tool call results.
    - **content** (object): Filler word content configuration. Defines the source and selection rules for filler words.
      - **mode** (string, possible values: `static`): Filler word content mode:
          - `static`: Static filler words. Uses a predefined list of filler words.
      - **{mode}_config** (object): Filler word content configuration parameters. The parameter name and structure vary depending on the content mode.- The configuration type must match `mode`. For example, when `mode` is `static`, you must provide `static_config`.
          - You cannot provide multiple mode configurations simultaneously.**Static filler word configuration example:**

          ```json
          "static_config": {
            "phrases": [
              "Please wait.",
              "Okay.",
              "Uh-huh."
            ],
            "selection_rule": "shuffle"
          }
          ```
        - **phrases** (array[string]): List of filler word phrases.
            
            **Limits:**
            - Maximum 100 filler words.
            - Each filler word must not exceed 50 English words.
        - **selection_rule** (string, possible values: `shuffle`, `round_robin`): Filler word selection rule:
            - `shuffle`: Random shuffle. Already-used filler words are not repeated until all filler words have been used once. After all filler words are played, they are reshuffled randomly and a new round begins.
            - `round_robin`: Round-robin. Selects and plays filler words sequentially from the list. After all filler words are played once, a new cycle begins.
  - **parameters** (object): Agent configuration parameters.
    - **silence_config** (object): Settings related to agent silence behavior.`silence_config` does not apply when you integrate a `mllm`.
      - **timeout_ms** (integer, possible values: `0 to 60000`): Specifies the maximum duration (in milliseconds) that the agent can remain silent. 
          After the agent is successfully created and the user joins the channel, any time during which the agent is not listening, thinking, or speaking is considered silent time. When the silent time reaches the specified value, the agent broadcasts a silent reminder message. This feature is useful for prompting users when they become inactive.
          - `0`: Disables the silent reminder feature.
          - `(0, 60000]`: Enables the silent reminder. You must also set `content`; otherwise, the configuration is invalid.
      - **action** (string): Specifies how the agent behaves when the silent timeout is reached. Valid values:
          - `speak`: Uses the TTS module to announce the silent prompt (`content`).
          - `think`: Appends the silent prompt (`content`) to the context and passes it to the LLM.
      - **content** (string): Specifies the silent prompt message. The message use depends on the value of `action` parameter.
    - **farewell_config** (object): Graceful hang-up settings for the agent.
      - **graceful_enabled** (boolean): Enable graceful leave:
          * `true`: Enabled. When enabled, calling the POST method to stop the agent ensures that the agent is in an `IDLE` state before leaving the channel.
          * `false`: Disabled.
      - **graceful_timeout_seconds** (integer, possible values: `[0`, `120]`): Graceful exit timeout (in seconds). Represents the maximum time to wait for the agent to enter an `IDLE` state before exiting the channel. After this time, the agent will exit the channel immediately, even if it is not in an idle state. This field is only effective when `graceful_enabled` is `true`.
    - **data_channel** (string): Agent data transmission channel:
      - `rtm`: Use RTM transmission. This configuration takes effect only when `advanced_features.enable_rtm` is `true`.
      - `datastream`: Use RTC data stream transport.
    - **enable_metrics** (boolean): Whether to receive agent performance data:
      - `true`: Receive agent performance data.
      - `false`: Do not receive agent performance data.
      
      This setting only takes effect when `advanced_features.enable_rtm` is `true`. See [Listen to agent events](https://docs-md.agora.io/en/conversational-ai/develop/webhooks.md) to learn how to use client components to receive agent performance data.
    - **enable_error_message** (boolean): Whether to receive agent error events:
      - `true`: Receive agent error events.
      - `false`: Do not receive agent error events.
      
      This setting only takes effect when `advanced_features.enable_rtm` is `true`. See [Listen to agent events](https://docs-md.agora.io/en/conversational-ai/develop/webhooks.md) to learn how to use client components to receive agent error events.
    - **audio_scenario** (string): The audio scenario for the RTC channel.

      - `default`: Maps to `aiserver`.
      - `chorus`: Real-time chorus scenario, where users have good network conditions and require ultra-low latency.
      - `aiserver`: Optimized for interactions between the user and the conversational AI agent in terms of latency and network resilience.

## Response

- If the returned status code is `200`, the request was successful. The response body contains the result of the request.

  **OK**

- **agent_id** (string): Unique id of the agent instance
- **create_ts** (integer): Timestamp of when the agent was created
- **status** (string, possible values: `IDLE`, `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, `RECOVERING`, `FAILED`): Current status.
    - `IDLE` (0): Agent is idle.
    - `STARTING` (1): The agent is being started.
    - `RUNNING` (2): The agent is running.
    - `STOPPING` (3): The agent is stopping.
    - `STOPPED` (4): The agent has exited.
    - `RECOVERING` (5): The agent is recovering.
    - `FAILED` (6): The agent failed to execute.

- If the returned status code is not `200`, the request failed. The response body includes the `detail` and `reason` for failure. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

### Reference

#### Deprecated parameters

The following turn detection configuration is deprecated. To create more natural conversations and reduce unintended interruptions, Agora recommends using the latest version of `turn_detection` above.

**Turn detection**

- **turn_detection** (object): Conversation turn detection settings.
  - **type** (string, possible values: `agora_vad`, `server_vad`, `semantic_vad`): Turn detection mechanism.
      - `agora_vad`:  Agora VAD. Compatible with both cascade (ASR/LLM/TTS) and MLLM modes.
      - `server_vad`: The model detects the start and end of speech based on audio volume and responds at the end of user speech. Only available when `mllm` is enabled and OpenAI Realtime or Gemini Live is selected. The detection behavior is controlled by the LLM provider.
      - `semantic_vad`: Uses a turn detection model in conjunction with VAD to semantically estimate whether the user has finished speaking, then dynamically sets a timeout based on this probability for more natural conversations. Only available when `mllm` is enabled and OpenAI is selected.
  - **interrupt_mode** (string): Sets the agent's behavior when human voice interrupts the agent while it is interacting (speaking or thinking). Choose from the following values:

        - `interrupt`: The agent immediately stops the current interaction and processes the human voice input.
        - `append`: The agent completes the current interaction, then processes the human voice input.
        - `ignore`: The agent discards the human voice input without processing or storing it in the context.
        - `keywords`: The agent stops its current interaction after detecting any of the keywords specified in `turn_detection.interrupt_keywords`.
        - `adaptive`: The agent dynamically increases the voice continuity threshold while speaking to reduce accidental interruptions.Only the `interrupt` mode is supported when you integrate an `mllm`.
  - **interrupt_duration_ms** (number): The amount of time in milliseconds that the user's voice must exceed the VAD threshold before an interruption is triggered.
  - **interrupt_keywords** (array[string]): Specifies the list of keywords that trigger an interruption when the `turn_detection.interrupt_mode` is set to `"keyword"`.

        When the agent detects any of these keywords in the user's speech, it immediately stops its current interaction and processes the new input.- Keyword recognition capabilities, such as support for multiple languages or dialects, depend on the ASR provider you choose.  
        - You can configure up to 128 keywords.
  - **prefix_padding_ms** (integer): The extra forward padding time in milliseconds before the processing system starts to process the speech input. This padding helps capture the beginning of the speech.
  - **silence_duration_ms** (integer): The duration of audio silence in milliseconds. If no voice activity is detected during this period, the agent assumes that the user has stopped speaking.
  - **threshold** (number, possible values: `(0.0`, `1.0)`): Identification sensitivity determines the level of sound in the audio signal that is considered voice activity. Lower values make it easier for the agent to detect speech, and higher values ignore weak sounds.
  - **eagerness** (string, possible values: `auto`, `low`, `high`): The eagerness of the model to respond:
      - `auto`: Equivalent to medium
      - `low`: Wait longer for the user to continue speaking
      - `high`: Respond more quickly
      
      Only available in `semantic_vad` mode when using OpenAI Realtime API.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request examples

**curl**
```bash
curl --request post \
--url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join \
--header 'Authorization: Basic' \
--data '
{
    "name": "unique_name",
    "properties": {
        "channel": "channel_name",
        "token": "token",
        "agent_rtc_uid": "1001",
        "remote_rtc_uids": [
    "1002"
        ],
        "idle_timeout": 120,
        "llm": {
    "url": "https://api.openai.com/v1/chat/completions",
    "api_key": "",
    "system_messages": [
    {
    "role": "system",
    "content": "You are a helpful chatbot."
    }
    ],
    "max_history": 32,
    "greeting_message": "Hello, how can I assist you today?",
    "failure_message": "Please hold on a second.",
    "params": {
    "model": "gpt-4o-mini"
    }
        },
        "tts": {
    "vendor": "microsoft",
    "params": {
    "key": "",
    "region": "eastus",
    "voice_name": "en-US-AndrewMultilingualNeural"
    }
        },
        "asr": {
    "language": "en-US"
        }
    }
}'
```

**Python**
```python
import requests
import json

url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join"

headers = {"Authorization": "Basic"}

data = {
    "name": "unique_name",
    "properties": {
        "channel": "channel_name",
        "token": "token",
        "agent_rtc_uid": "1001",
        "remote_rtc_uids": ["1002"],
        "idle_timeout": 120,
        "llm": {
    "url": "https://api.openai.com/v1/chat/completions",
    "api_key": "",
    "system_messages": [
    {
    "role": "system",
    "content": "You are a helpful chatbot."
    }
    ],
    "max_history": 32,
    "greeting_message": "Hello, how can I assist you today?",
    "failure_message": "Please hold on a second.",
    "params": {
    "model": "gpt-4o-mini"
    }
        },
        "tts": {
    "vendor": "microsoft",
    "params": {
    "key": "",
    "region": "eastus",
    "voice_name": "en-US-AndrewMultilingualNeural"
    }
        },
        "asr": {
    "language": "en-US"
        }
    }
}

response = requests.post(url, headers=headers, data=json.dumps(data))

print(response.status_code)
print(response.json())
```

**Node.js**
```js
const axios = require("axios");

const url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join";

const headers = {
    "Authorization": "Basic"
};

const data = {
    name: "unique_name",
    properties: {
    channel: "channel_name",
    token: "token",
    agent_rtc_uid: "1001",
    remote_rtc_uids: ["1002"],
    idle_timeout: 120,
    llm: {
        url: "https://api.openai.com/v1/chat/completions",
        api_key: "",
        system_messages: [
        {
    role: "system",
    content: "You are a helpful chatbot."
        }
        ],
        max_history: 32,
        greeting_message: "Hello, how can I assist you today?",
        failure_message: "Please hold on a second.",
        params: {
        model: "gpt-4o-mini"
        }
    },
    tts: {
        vendor: "microsoft",
        params: {
        key: "",
        region: "eastus",
        voice_name: "en-US-AndrewMultilingualNeural"
        }
    },
    asr: {
        language: "en-US"
    }
    }
};

axios
    .post(url, data, { headers })
    .then(response => {
    console.log("Status:", response.status);
    console.log("Response:", response.data);
    })
    .catch(error => {
    console.error("Error:", error.response ? error.response.data : error.message);
    });
```

**curl**
```bash
curl -X POST 'https://api.agora.io/api/conversational-ai-agent/v2/projects//join' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: agora token=' \
  -d '{
    "name": "",
    "pipeline_id": "",
    "properties": {
      "channel": "",
      "token": "",
      "agent_rtc_uid": "1001",
      "agent_rtm_uid": "",
      "remote_rtc_uids": ["1002"],
      "enable_string_uid": false
    }
  }'
```

**Python**
```python
import requests
import json

url = "https://api.agora.io/api/conversational-ai-agent/v2/projects//join"

headers = {
    "Content-Type": "application/json",
    "Authorization": "agora token="
}

data = {
    "name": "",
    "pipeline_id": "",
    "properties": {
        "channel": "",
        "token": "",
        "agent_rtc_uid": "1001",
        "agent_rtm_uid": "",
        "remote_rtc_uids": ["1002"],
        "enable_string_uid": False
    }
}

response = requests.post(url, headers=headers, data=json.dumps(data))
print(response.json())
```

**Node.js**
```js
const url = "https://api.agora.io/api/conversational-ai-agent/v2/projects//join";

const headers = {
  "Content-Type": "application/json",
  "Authorization": "agora token="
};

const data = {
  name: "",
  pipeline_id: "",
  properties: {
    channel: "",
    token: "",
    agent_rtc_uid: "1001",
    agent_rtm_uid: "",
    remote_rtc_uids: ["1002"],
    enable_string_uid: false
  }
};

fetch(url, {
  method: "POST",
  headers: headers,
  body: JSON.stringify(data)
})
  .then(response => response.json())
  .then(json => console.log(json))
  .catch(error => console.error("Error:", error));
```

**curl**
```bash
curl --request POST \
  --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join \
  --header 'Authorization: Basic' \
  --data '
{
  "name": "unique_name",
  "properties": {
    "channel": "channel_name",
    "token": "token",
    "agent_rtc_uid": "1001",
    "remote_rtc_uids": [
      "1002"
    ],
    "idle_timeout": 120,
    "llm": {
      "url": "https://api.openai.com/v1/chat/completions",
      "api_key": "",
      "system_messages": [
        {
    "role": "system",
    "content": "You are a helpful assistant. User name is {{user_name}}, and their account ID is {{account_id}}."
        }
      ],
      "greeting_message": "Hello {{user_name}}, how can I help you?",
      "failure_message": "Sorry, {{user_name}}, I cannot answer this question. Please try again later.",
      "max_history": 32,
      "params": {
        "model": "gpt-4o-mini"
      },
      "template_variables": {
        "user_name": "John",
        "account_id": "ACC123456",
        "silent_prompt": "If the user does not respond for an extended period, please inquire whether you require continued service."
      },
      "mcp_servers": [
    {
    "name": "mcpserver",
    "transport": "streamable_http",
    "endpoint": "https://registry.run.mcp.com.ai/mcp",
    "allowed_tools": [
    "getV01Servers"
    ],
    }
      ]
    },
    "asr": {
      "language": "en-US"
    },
    "tts": {
      "vendor": "minimax",
      "skip_patterns": [
        1
      ],
      "params": {
        "group_id": "xxxx",
        "key": "xxxx",
        "model": "speech-01-turbo",
        "voice_setting": {
    "voice_id": "English_captivating_female1",
    "speed": 1,
    "vol": 1,
    "pitch": 0,
    "emotion": "happy"
        },
        "audio_setting": {
    "sample_rate": 16000
        }
      }
    },
    "parameters": {
      "silence_config": {
        "timeout_ms": 10000,
        "action": "think",
        "content": "{{silent_prompt}}"
      }
    }
  }
}'
```

**Python**
```python
import requests

url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join"

payload = {
    "name": "unique_name",
    "properties": {
        "channel": "channel_name",
        "token": "token",
        "agent_rtc_uid": "1001",
        "remote_rtc_uids": ["1002"],
        "idle_timeout": 120,
        "llm": {
    "url": "https://api.openai.com/v1/chat/completions",
    "api_key": "",
    "system_messages": [
    {
    "role": "system",
    "content": "You are a helpful assistant. User name is {{user_name}}, and their account ID is {{account_id}}."
    }
    ],
    "greeting_message": "Hello {{user_name}}, how can I help you?",
    "failure_message": "Sorry, {{user_name}}, I cannot answer this question. Please try again later.",
    "max_history": 32,
    "params": {
    "model": "gpt-4o-mini"
    },
    "template_variables": {
    "user_name": "John",
    "account_id": "ACC123456",
    "silent_prompt": "If the user does not respond for an extended period, please inquire whether you require continued service."
    },
    "mcp_servers": [
    {
    "name": "mcpserver",
    "transport": "streamable_http",
    "endpoint": "https://registry.run.mcp.com.ai/mcp",
    "allowed_tools": ["getV01Servers"]
    }
    ]
        },
        "asr": {
    "language": "en-US"
        },
        "tts": {
    "vendor": "minimax",
    "skip_patterns": [1],
    "params": {
    "group_id": "xxxx",
    "key": "xxxx",
    "model": "speech-01-turbo",
    "voice_setting": {
    "voice_id": "English_captivating_female1",
    "speed": 1,
    "vol": 1,
    "pitch": 0,
    "emotion": "happy"
    },
    "audio_setting": { "sample_rate": 16000 }
    }
        },
        "parameters": { "silence_config": {
    "timeout_ms": 10000,
    "action": "think",
    "content": "{{silent_prompt}}"
    } }
    }
}
headers = {"Authorization": "Basic"}

response = requests.post(url, json=payload, headers=headers)

print(response.text)
```

**Node.js**
```js
const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join';
const options = {
  method: 'POST',
  headers: {Authorization: 'Basic'},
  body: JSON.stringify({
    name: 'unique_name',
    properties: {
      channel: 'channel_name',
      token: 'token',
      agent_rtc_uid: '1001',
      remote_rtc_uids: ['1002'],
      idle_timeout: 120,
      llm: {
        url: 'https://api.openai.com/v1/chat/completions',
        api_key: '',
        system_messages: [
    {
    role: 'system',
    content: 'You are a helpful assistant. User name is {{user_name}}, and their account ID is {{account_id}}.'
    }
        ],
        greeting_message: 'Hello {{user_name}}, how can I help you?',
        failure_message: 'Sorry, {{user_name}}, I cannot answer this question. Please try again later.',
        max_history: 32,
        params: {model: 'gpt-4o-mini'},
        template_variables: {
    user_name: 'John',
    account_id: 'ACC123456',
    silent_prompt: 'If the user does not respond for an extended period, please inquire whether you require continued service.'
        },
        mcp_servers: [
    {
    name: 'mcpserver',
    transport: 'streamable_http',
    endpoint: 'https://registry.run.mcp.com.ai/mcp',
    allowed_tools: ['getV01Servers']
    }
        ]
      },
      asr: {language: 'en-US'},
      tts: {
        vendor: 'minimax',
        skip_patterns: [1],
        params: {
    group_id: 'xxxx',
    key: 'xxxx',
    model: 'speech-01-turbo',
    voice_setting: {voice_id: 'English_captivating_female1', speed: 1, vol: 1, pitch: 0, emotion: 'happy'},
    audio_setting: {sample_rate: 16000}
        }
      },
      parameters: {
        silence_config: {timeout_ms: 10000, action: 'think', content: '{{silent_prompt}}'}
      }
    }
  })
};

fetch(url, options)
  .then(res => res.json())
  .then(json => console.log(json))
  .catch(err => console.error(err));
```

**curl**
```bash
curl --request POST \
  --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join \
  --header 'Authorization: Basic' \
  --data '
{
  "name": "full_config_agent",
  "properties": {
    "channel": "full_channel_name",
    "token": "full_token_value",
    "agent_rtc_uid": "12345",
    "remote_rtc_uids": [
      "67890"
    ],
    "enable_string_uid": false,
    "idle_timeout": 180,
    "advanced_features": {
      "enable_rtm": true,
      "enable_sal": true
    },
    "asr": {
      "language": "en-US",
      "vendor": "microsoft",
      "params": {
        "key": "your_microsoft_key",
        "region": "eastus",
        "language": "en-US",
        "phrase_list": [
    "agora",
    "fengming"
        ]
      }
    },
    "tts": {
      "vendor": "microsoft",
      "skip_patterns": [
        1,
        2
      ],
      "params": {
        "key": "your_microsoft_key",
        "region": "eastus",
        "voice_name": "en-US-AndrewMultilingualNeural",
        "speed": 1,
        "volume": 70,
        "sample_rate": 24000
      }
    },
    "llm": {
      "url": "https://api.openai.com/v1/chat/completions",
      "api_key": "your_openai_api_key",
      "system_messages": [
        {
    "role": "system",
    "content": "You are a professional AI assistant. User name is {{user_name}}."
        }
      ],
      "greeting_message": "Hello {{user_name}}, I am your smart assistant. How can I help you?",
      "greeting_configs": {
        "mode": "single_every"
      },
      "failure_message": "Sorry, there was a system problem. Please try again later.",
      "max_history": 64,
      "input_modalities": [
        "text",
        "image"
      ],
      "output_modalities": [
        "text"
      ],
      "params": {
        "model": "gpt-4o",
        "temperature": 0.8,
        "max_tokens": 2048,
        "stream": true
      },
      "template_variables": {
        "user_name": "John",
        "company_name": "Agora"
      }
    },
    "avatar": {
      "vendor": "heygen",
      "enable": true,
      "params": {
        "api_key": "",
        "quality": "medium",
        "agora_uid": "",
        "agora_token": "",
        "avatar_id": "",
        "disable_idle_timeout": false,
        "activity_idle_timeout": 60
      }
    },
    "turn_detection": {
      "mode": "default",
      "config": {
        "speech_threshold": 0.5,
        "start_of_speech": {
    "mode": "vad",
    "vad_config": {
    "interrupt_duration_ms": 160,
    "speaking_interrupt_duration_ms": 320,
    "prefix_padding_ms": 800
    }
        },
        "end_of_speech": {
    "mode": "semantic",
    "semantic_config": {
    "silence_duration_ms": 320,
    "max_wait_ms": 3000
    }
        }
      }
    },
    "sal": {
      "sal_mode": "locking",
      "sample_urls": {
        "speaker1": "https://example.com/voiceprint1.pcm"
      }
    },
    "labels": {
      "campaign_id": "spring_2025",
      "customer_group": "vip",
      "region": "eastus"
    },
    "rtc": {
      "encryption_key": "your_32_byte_encryption_key_here",
      "encryption_salt": "TsP4fLLyxxxxxxxxxroLA9oE=",
      "encryption_mode": 8
    },
    "filler_words": {
      "enable": true,
      "trigger": {
        "mode": "fixed_time",
        "config": {
    "response_wait_ms": 1500
        }
      },
      "content": {
        "mode": "static",
        "config": {
    "phrases": [
    "Please wait a moment.",
    "OK",
    "Uh-huh."
    ],
    "selection_rule": "shuffle"
        }
      }
    },
    "parameters": {
      "silence_config": {
        "timeout_ms": 15000,
        "action": "think",
        "content": "User has not responded for an extended period. Please inquire whether continued service is needed."
      },
      "farewell_config": {
        "graceful_enabled": true,
        "graceful_timeout_seconds": 60
      },
      "data_channel": "rtm",
      "enable_metrics": true,
      "enable_error_message": true
    }
  }
}'
```

**Python**
```python
import requests

url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join"

payload = {
    "name": "full_config_agent",
    "properties": {
        "channel": "full_channel_name",
        "token": "full_token_value",
        "agent_rtc_uid": "12345",
        "remote_rtc_uids": ["67890"],
        "enable_string_uid": False,
        "idle_timeout": 180,
        "advanced_features": {
    "enable_rtm": True,
    "enable_sal": True
        },
        "asr": {
    "language": "en-US",
    "vendor": "microsoft",
    "params": {
    "key": "your_microsoft_key",
    "region": "eastus",
    "language": "en-US",
    "phrase_list": ["agora", "fengming"]
    }
        },
        "tts": {
    "vendor": "microsoft",
    "skip_patterns": [1, 2],
    "params": {
    "key": "your_microsoft_key",
    "region": "eastus",
    "voice_name": "en-US-AndrewMultilingualNeural",
    "speed": 1,
    "volume": 70,
    "sample_rate": 24000
    }
        },
        "llm": {
    "url": "https://api.openai.com/v1/chat/completions",
    "api_key": "your_openai_api_key",
    "system_messages": [
    {
    "role": "system",
    "content": "You are a professional AI assistant. User name is {{user_name}}."
    }
    ],
    "greeting_message": "Hello {{user_name}}, I am your smart assistant. How can I help you?",
    "greeting_configs": { "mode": "single_every" },
    "failure_message": "Sorry, there was a system problem. Please try again later.",
    "max_history": 64,
    "input_modalities": ["text", "image"],
    "output_modalities": ["text"],
    "params": {
    "model": "gpt-4o",
    "temperature": 0.8,
    "max_tokens": 2048,
    "stream": True
    },
    "template_variables": {
    "user_name": "John",
    "company_name": "Agora"
    }
        },
        "avatar": {
    "vendor": "heygen",
    "enable": True,
    "params": {
    "api_key": "",
    "quality": "medium",
    "agora_uid": "",
    "agora_token": "",
    "avatar_id": "",
    "disable_idle_timeout": False,
    "activity_idle_timeout": 60
    }
        },
        "turn_detection": {
    "mode": "default",
    "config": {
    "speech_threshold": 0.5,
    "start_of_speech": {
    "mode": "vad",
    "vad_config": {
    "interrupt_duration_ms": 160,
    "speaking_interrupt_duration_ms": 320,
    "prefix_padding_ms": 800
    }
    },
    "end_of_speech": {
    "mode": "semantic",
    "semantic_config": {
    "silence_duration_ms": 320,
    "max_wait_ms": 3000
    }
    }
    }
        },
        "sal": {
    "sal_mode": "locking",
    "sample_urls": { "speaker1": "https://example.com/voiceprint1.pcm" }
        },
        "labels": {
    "campaign_id": "spring_2025",
    "customer_group": "vip",
    "region": "eastus"
        },
        "rtc": {
    "encryption_key": "your_32_byte_encryption_key_here",
    "encryption_salt": "TsP4fLLyxxxxxxxxxroLA9oE=",
    "encryption_mode": 8
        },
        "filler_words": {
    "enable": True,
    "trigger": {
    "mode": "fixed_time",
    "config": { "response_wait_ms": 1500 }
    },
    "content": {
    "mode": "static",
    "config": {
    "phrases": ["Please wait a moment.", "OK", "Uh-huh."],
    "selection_rule": "shuffle"
    }
    }
        },
        "parameters": {
    "silence_config": {
    "timeout_ms": 15000,
    "action": "think",
    "content": "User has not responded for an extended period. Please inquire whether continued service is needed."
    },
    "farewell_config": {
    "graceful_enabled": True,
    "graceful_timeout_seconds": 60
    },
    "data_channel": "rtm",
    "enable_metrics": True,
    "enable_error_message": True
        }
    }
}
headers = {"Authorization": "Basic"}

response = requests.post(url, json=payload, headers=headers)

print(response.text)
```

**Node.js**
```js
const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join';
const options = {
  method: 'POST',
  headers: {Authorization: 'Basic'},
  body: JSON.stringify({
    name: 'full_config_agent',
    properties: {
      channel: 'full_channel_name',
      token: 'full_token_value',
      agent_rtc_uid: '12345',
      remote_rtc_uids: ['67890'],
      enable_string_uid: false,
      idle_timeout: 180,
      advanced_features: {enable_rtm: true, enable_sal: true},
      asr: {
        language: 'en-US',
        vendor: 'microsoft',
        params: {
    key: 'your_microsoft_key',
    region: 'eastus',
    language: 'en-US',
    phrase_list: ['agora', 'fengming']
        }
      },
      tts: {
        vendor: 'microsoft',
        skip_patterns: [1, 2],
        params: {
    key: 'your_microsoft_key',
    region: 'eastus',
    voice_name: 'en-US-AndrewMultilingualNeural',
    speed: 1,
    volume: 70,
    sample_rate: 24000
        }
      },
      llm: {
        url: 'https://api.openai.com/v1/chat/completions',
        api_key: 'your_openai_api_key',
        system_messages: [
    {
    role: 'system',
    content: 'You are a professional AI assistant. User name is {{user_name}}.'
    }
        ],
        greeting_message: 'Hello {{user_name}}, I am your smart assistant. How can I help you?',
        greeting_configs: {mode: 'single_every'},
        failure_message: 'Sorry, there was a system problem. Please try again later.',
        max_history: 64,
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        vendor: 'custom',
        params: {model: 'gpt-4o', temperature: 0.8, max_tokens: 2048, stream: true},
        template_variables: {user_name: 'John', company_name: 'Agora'}
      },
      avatar: {
        vendor: 'heygen',
        enable: true,
        params: {
    api_key: '',
    quality: 'medium',
    agora_uid: '',
    agora_token: '',
    avatar_id: '',
    disable_idle_timeout: false,
    activity_idle_timeout: 60
        }
      },
      turn_detection: {
        mode: 'default',
        config: {
    speech_threshold: 0.5,
    start_of_speech: {
    mode: 'vad',
    vad_config: {
    interrupt_duration_ms: 160,
    speaking_interrupt_duration_ms: 320,
    prefix_padding_ms: 800
    }
    },
    end_of_speech: {
    mode: 'semantic',
    semantic_config: {silence_duration_ms: 320, max_wait_ms: 3000}
    }
        }
      },
      sal: {
        sal_mode: 'locking',
        sample_urls: {speaker1: 'https://example.com/voiceprint1.pcm'}
      },
      labels: {campaign_id: 'spring_2025', customer_group: 'vip', region: 'eastus'},
      rtc: {
        encryption_key: 'your_32_byte_encryption_key_here',
        encryption_salt: 'TsP4fLLyxxxxxxxxxroLA9oE=',
        encryption_mode: 8
      },
      filler_words: {
        enable: true,
        trigger: {mode: 'fixed_time', config: {response_wait_ms: 1500}},
        content: {
    mode: 'static',
    config: {phrases: ['Please wait a moment.', 'OK', 'Uh-huh.'], selection_rule: 'shuffle'}
        }
      },
      parameters: {
        silence_config: {timeout_ms: 15000, action: 'think', content: 'User has not responded for an extended period. Please inquire whether continued service is needed.'},
        farewell_config: {graceful_enabled: true, graceful_timeout_seconds: 60},
        data_channel: 'rtm',
        enable_metrics: true,
        enable_error_message: true
      }
    }
  })
};

fetch(url, options)
  .then(res => res.json())
  .then(json => console.log(json))
  .catch(err => console.error(err));
```

**curl**
```bash
curl --request POST \
  --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join \
  --header 'Authorization: Basic' \
  --data '
{
  "name": "unique_name",
  "properties": {
    "channel": "channel_name",
    "token": "token",
    "agent_rtc_uid": "friday",
    "remote_rtc_uids": [
      "1002"
    ],
    "enable_string_uid": true,
    "idle_timeout": 120,
    "llm": {
      "url": "https://api.openai.com/v1/chat/completions",
      "api_key": "",
      "system_messages": [
        {
    "role": "system",
    "content": "You are a helpful chatbot."
        }
      ],
      "greeting_message": "Hello, how can I help you?",
      "failure_message": "I'm sorry, I can't answer that question.",
      "max_history": 32,
      "params": {
        "model": "gpt-4o-mini"
      }
    },
    "asr": {
      "language": "en-US"
    },
    "tts": {
      "vendor": "microsoft",
      "params": {
        "key": "",
        "region": "eastus",
        "voice_name": "en-US-AndrewMultilingualNeural"
      }
    }
  }
}'
```

**Python**
```python
import requests

url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join"

payload = {
    "name": "unique_name",
    "properties": {
        "channel": "channel_name",
        "token": "token",
        "agent_rtc_uid": "friday",
        "remote_rtc_uids": ["1002"],
        "enable_string_uid": True,
        "idle_timeout": 120,
        "llm": {
    "url": "https://api.openai.com/v1/chat/completions",
    "api_key": "",
    "system_messages": [
    {
    "role": "system",
    "content": "You are a helpful chatbot."
    }
    ],
    "greeting_message": "Hello, how can I help you?",
    "failure_message": "I'm sorry, I can't answer that question.",
    "max_history": 32,
    "params": {
    "model": "gpt-4o-mini"
    }
        },
        "asr": {
    "language": "en-US"
        },
        "tts": {
    "vendor": "microsoft",
    "params": {
    "key": "",
    "region": "eastus",
    "voice_name": "en-US-AndrewMultilingualNeural"
    }
        }
    }
}
headers = {"Authorization": "Basic"}

response = requests.post(url, json=payload, headers=headers)

print(response.text)
```

**Node.js**
```js
const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join';
const options = {
  method: 'POST',
  headers: {Authorization: 'Basic'},
  body: JSON.stringify({
    name: 'unique_name',
    properties: {
      channel: 'channel_name',
      token: 'token',
      agent_rtc_uid: 'friday',
      remote_rtc_uids: ['1002'],
      enable_string_uid: true,
      idle_timeout: 120,
      llm: {
        url: 'https://api.openai.com/v1/chat/completions',
        api_key: '',
        system_messages: [{role: 'system', content: 'You are a helpful chatbot.'}],
        greeting_message: 'Hello, how can I help you?',
        failure_message: 'I'm sorry, I can't answer that question.',
        max_history: 32,
        params: {model: 'gpt-4o-mini'}
      },
      asr: {language: 'en-US'},
      tts: {
        vendor: 'microsoft',
        params: {
    key: '',
    region: 'eastus',
    voice_name: 'en-US-AndrewMultilingualNeural'
        }
      }
    }
  })
};

fetch(url, options)
  .then(res => res.json())
  .then(json => console.log(json))
  .catch(err => console.error(err));
```

**curl**
```bash
curl --request POST \
--url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/join \
--header 'Authorization: Basic' \
--data '
{
    "name": "unique_name",
    "preset": "deepgram_nova_3,openai_gpt_5_mini,minimax_speech_2_6_turbo",
    "properties": {
        "channel": "channel_name",
        "token": "token",
        "agent_rtc_uid": "1001",
        "remote_rtc_uids": [
    "1002"
        ],
        "idle_timeout": 120,
        "llm": {
    "system_messages": [
    {
    "role": "system",
    "content": "You are a helpful chatbot."
    }
    ],
    "max_history": 32,
    "greeting_message": "Hello, how can I assist you today?",
    "failure_message": "Please hold on a second."
        },
        "tts": {
    "vendor": "minimax",
    "params": {
    "voice_setting": {
    "voice_id": "English_captivating_female1"
    }
    }
        },
        "asr": {
    "vendor": "deepgram",
    "params": {
    "language": "en",
    "keyterm": "agora"
    }
        }
    }
}'
```

**Python**
```python
import requests
import base64

app_id = ""
credentials = ""

url = f"https://api.agora.io/api/conversational-ai-agent/v2/projects/{app_id}/join"

headers = {
    "Authorization": f"Basic {credentials}",
    "Content-Type": "application/json"
}

payload = {
    "name": "unique_name",
    "preset": "deepgram_nova_3,openai_gpt_5_mini,minimax_speech_2_6_turbo",
    "properties": {
        "channel": "channel_name",
        "token": "token",
        "agent_rtc_uid": "1001",
        "remote_rtc_uids": ["1002"],
        "idle_timeout": 120,
        "llm": {
    "system_messages": [
    {
    "role": "system",
    "content": "You are a helpful chatbot."
    }
    ],
    "max_history": 32,
    "greeting_message": "Hello, how can I assist you today?",
    "failure_message": "Please hold on a second."
        },
        "tts": {
    "vendor": "minimax",
    "params": {
    "voice_setting": {
    "voice_id": "English_captivating_female1"
    }
    }
        },
        "asr": {
    "vendor": "deepgram",
    "params": {
    "language": "en",
    "keyterm": "agora"
    }
        }
    }
}

response = requests.post(url, headers=headers, json=payload)
print(response.status_code)
print(response.json())
```

**Node.js**
```js
const appId = "";
const credentials = "";

const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/join`;

const payload = {
  name: "unique_name",
  preset: "deepgram_nova_3,openai_gpt_5_mini,minimax_speech_2_6_turbo",
  properties: {
    channel: "channel_name",
    token: "token",
    agent_rtc_uid: "1001",
    remote_rtc_uids: ["1002"],
    idle_timeout: 120,
    llm: {
      system_messages: [
        {
    role: "system",
    content: "You are a helpful chatbot."
        }
      ],
      max_history: 32,
      greeting_message: "Hello, how can I assist you today?",
      failure_message: "Please hold on a second."
    },
    tts: {
      vendor: "minimax",
      params: {
        voice_setting: {
    voice_id: "English_captivating_female1"
        }
      }
    },
    asr: {
      vendor: "deepgram",
      params: {
        language: "en",
        keyterm: "agora"
      }
    }
  }
};

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Authorization": `Basic ${credentials}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

const data = await response.json();
console.log(response.status);
console.log(data);
```

## Response example

```json
  {
    "agent_id": "1NT29X10YHxxxxxWJOXLYHNYB",
    "create_ts": 1737111452,
    "status": "RUNNING"
  }
  ```

-----

---
title: Stop a conversational AI agent
description: Stop the specified conversational agent instance.
sidebar_position: 2
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/leave
exported_on: '2026-05-01T05:34:27.015393Z'
exported_file: leave.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/leave)

# Stop a conversational AI agent


**Method:** POST
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}/leave`

Use this endpoint to stop the specified Conversational AI agent instance.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
- **agentId** (string, required): The agent instance ID you obtained after successfully calling `join` to [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md).

## Response

- If the returned status code is `200`, the request was successful. The response body is empty.

- If the returned status code is not `200`, the request failed. The response body includes the error code and description. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
      curl --request post \
        --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentid/leave \
        --header 'Authorization: Basic'
```

**Python**
```python
    import requests

    url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/leave"

    headers = {
        "Authorization": "Basic",
        "Content-Type": "application/json"
    }

    response = requests.post(url, headers=headers)
    print(response.text)
```

**Node.js**
```js
    const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/leave';

    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Basic',
        'Content-Type': 'application/json'
      }
    };

    fetch(url, options)
      .then(res => res.json())
      .then(json => console.log(json))
      .catch(err => console.error(err));
```

------

---
title: Update agent configuration
description: Adjust Conversation AI Engine parameters at runtime.
sidebar_position: 3
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/update
exported_on: '2026-05-01T05:34:28.587551Z'
exported_file: update.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/update)

# Update agent configuration


**Method:** POST
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}/update`

Use this endpoint to adjust Conversational AI agent instance parameters at runtime.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
- **agentId** (string, required): The agent instance ID you obtained after successfully calling `join` to [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md).
### Request body

APPLICATION/JSON
**BODY**

- **properties** (object): 
  - **token** (string): The authentication token used by the agent to join the channel.
  - **llm** (object): Large Language Model (LLM) settings.
    - **system_messages** (array[object]): A set of predefined messages appended to the beginning of each LLM request. These messages help control the LLM’s output and can include role definitions, prompts, response examples, and more. This field must be compatible with the OpenAI protocol.
    - **params** (object): Additional LLM information included in the message body, such as the model used, the maximum number of tokens, and more. Supported configurations vary by LLM provider. Refer to the provider’s documentation for details.Updating this field overwrites the configuration set when the agent was created. When updating, make sure to pass the complete `params` field.
  - **mllm** (object): Multimodal Large Language Model (MLLM) configuration for real-time audio and text processing.
    - **params** (object): Additional MLLM configuration parameters.
        See [MLLM Overview](https://docs-md.agora.io/en/conversational-ai/models/mllm/overview.md) for details.

## Response

- If the returned status code is `200`, the request was successful. The response body contains the result of the request.

  **OK**

- **agent_id** (string): Unique id of the agent instance
- **create_ts** (integer): Timestamp of when the agent was created
- **status** (string, possible values: `IDLE`, `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, `RECOVERING`, `FAILED`): Current status.
    - `IDLE` (0): Agent is idle.
    - `STARTING` (1): The agent is being started.
    - `RUNNING` (2): The agent is running.
    - `STOPPING` (3): The agent is stopping.
    - `STOPPED` (4): The agent has exited.
    - `RECOVERING` (5): The agent is recovering.
    - `FAILED` (6): The agent failed to execute.

- If the returned status code is not `200`, the request failed. The response body includes the `detail` and `reason` for failure. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
      curl --request post \
        --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/update \
        --header 'Authorization: Basic' \
        --data '
      {
        "properties": {
    "token": "007eJxTYxxxxxxxxxxIaHMLAAAA0ex66",
    "llm": {
    "system_messages": [
    {
    "role": "system",
    "content": "You are a helpful assistant. xxx"
    },
    {
    "role": "system",
    "content": "Previously, user has talked about their favorite hobbies with some key topics: xxx"
    }
    ],
    "params": {
    "model": "abab6.5s-chat",
    "max_token": 1024
    }
    }
        }
      }'
```

**Python**
```python
    import requests
    import json

    url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}/update"
    headers = {
      "Authorization": "Basic",
      "Content-Type": "application/json"
    }

    data = {
      "properties": {
    "token": "007eJxTYxxxxxxxxxxIaHMLAAAA0ex66",
    "llm": {
    "system_messages": [
    {
    "role": "system",
    "content": "You are a helpful assistant. xxx"
    },
    {
    "role": "system", 
    "content": "Previously, user has talked about their favorite hobbies with some key topics: xxx"
    }
    ],
    "params": {
    "model": "abab6.5s-chat",
    "max_token": 1024
    }
    }
      }
    }

    response = requests.post(url, headers=headers, json=data)
    print(response.status_code)
    print(response.json())
```

**Node.js**
```js
    const fetch = require('node-fetch');

    const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/update';

    const headers = {
      'Authorization': 'Basic',
      'Content-Type': 'application/json'
    };

    const data = {
      properties: {
    token: "007eJxTYxxxxxxxxxxIaHMLAAAA0ex66",
    llm: {
    system_messages: [
    {
    role: "system",
    content: "You are a helpful assistant. xxx"
    },
    {
    role: "system",
    content: "Previously, user has talked about their favorite hobbies with some key topics: xxx"
    }
    ],
    params: {
    model: "abab6.5s-chat",
    max_token: 1024
    }
    }
      }
    };

    fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error:', error));
```

## Response example

```json
  {
    "agent_id": "1NT29X10YHxxxxxWJOXLYHNYB",
    "create_ts": 1737123456,
    "status": "RUNNING"
  }
  ```


-----

---
title: Send a custom instruction
description: Send a custom text instruction to the specified conversational AI agent.
sidebar_position: 3.5
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/think
exported_on: '2026-05-01T05:34:28.081457Z'
exported_file: think.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/think)

# Send a custom instruction


**Method:** POST
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}/think`

Use this endpoint to send a custom text instruction to the specified Conversational AI agent instance. The instruction is injected into the current conversation pipeline as user input, and the agent processes and responds to it following the standard user input logic.

Use this endpoint for the following scenarios:

- **Implicit instruction injection**: Inject hidden context or directives into the conversation.
- **Client-side event triggering**: Notify the agent of client-side events, such as a user clicking a button.
- **Voice and text collaboration**: Combine text instructions with voice input for richer interaction.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
- **agentId** (string, required): The agent instance ID you obtained after successfully calling `join` to [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md).
### Request body

APPLICATION/JSON
**BODY**

- **text** (string): The custom instruction text to inject into the current conversation pipeline. The system processes this as user input.
- **on_listening_action** (string, possible values: `inject`, `ignore`): The action to take when the agent is in a listening state:
    - `inject`: Inject the custom text instruction into the current turn without interrupting it.
    - `ignore`: Ignore the request.
- **on_thinking_action** (string, possible values: `interrupt`, `ignore`): The action to take when the agent is in a thinking state:
    - `interrupt`: Interrupt the current state and start a new conversation turn.
    - `ignore`: Ignore the request.
- **on_speaking_action** (string, possible values: `interrupt`, `ignore`): The action to take when the agent is in a speaking state:
    - `interrupt`: Interrupt the current state and start a new conversation turn.
    - `ignore`: Ignore the request.
- **interruptable** (boolean): Whether user speech can interrupt the injected instruction:
    - `true`: User speech can interrupt the instruction.
    - `false`: User speech cannot interrupt the instruction.
- **metadata** (object): Custom metadata in key-value pair format. Use this field to pass additional business information such as identifiers or model references.

## Response

- If the returned status code is `200`, the request was successful. The response body contains the result of the request.

  **OK**

- **agent_id** (string): Unique identifier of the agent instance.
- **channel** (string): The name of the RTC channel where the agent is located.
- **start_ts** (integer): Timestamp indicating when the agent was created.

- If the returned status code is not `200`, the request failed. The response body includes the `detail` and `reason` for failure. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
  curl --request POST \
    --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/think \
    --header 'Authorization: Basic' \
    --header 'Content-Type: application/json' \
    --data '{
      "text": "The user just clicked the purchase button.",
      "on_listening_action": "inject",
      "on_thinking_action": "interrupt",
      "on_speaking_action": "ignore",
      "interruptable": true,
      "metadata": {
        "publisher": "user123",
        "model": "deepseek-r1"
      }
    }'
```

**Python**
```python
  import requests

  url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/think"
  headers = {
      "Authorization": "Basic",
      "Content-Type": "application/json"
  }
  payload = {
      "text": "The user just clicked the purchase button.",
      "on_listening_action": "inject",
      "on_thinking_action": "interrupt",
      "on_speaking_action": "ignore",
      "interruptable": True,
      "metadata": {
    "publisher": "user123",
    "model": "deepseek-r1"
      }
  }

  response = requests.post(url, json=payload, headers=headers)
  print(response.text)
```

**Node.js**
```js
const axios = require("axios");

const url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/think";
const headers = {
    Authorization: "Basic",
    "Content-Type": "application/json"
};
const payload = {
    text: "The user just clicked the purchase button.",
    on_listening_action: "inject",
    on_thinking_action: "interrupt",
    on_speaking_action: "ignore",
    interruptable: true,
    metadata: {
        publisher: "user123",
        model: "deepseek-r1"
    }
};

axios.post(url, payload, { headers })
  .then(response => console.log(response.data))
  .catch(error => console.error(error.response ? error.response.data : error.message));
```

## Response example

```json
{
  "agent_id": "1NT29XxxxxxxxxELWEHC8OS",
  "channel": "test_channel",
  "start_ts": 1744877089
}
```


------

---
title: Query agent status
description: Get the current state information of the specified agent instance.
sidebar_position: 4
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/query
exported_on: '2026-05-01T05:34:27.576924Z'
exported_file: query.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/query)

# Query agent status


**Method:** GET
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}`

Use this endpoint to get the current status of the specified Conversational AI agent instance.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
- **agentId** (string, required): The agent instance ID you obtained after successfully calling `join` to [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md).

## Response

- If the returned status code is `200`, the request was successful. The response body contains the result of the request.

  **OK**

- **message** (string): Request message.
- **start_ts** (integer): Agent creation timestamp.
- **stop_ts** (integer): Agent stop timestamp.
- **name** (string): The agent name provided when calling [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md). Unique within a channel.
- **status** (string, possible values: `IDLE`, `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, `RECOVERING`, `FAILED`): Current status.
        `IDLE` (0): Agent is idle.
        `STARTING` (1): The agent is being started.
        `RUNNING` (2): The agent is running.
        `STOPPING` (3): The agent is stopping.
        `STOPPED` (4): The agent has exited.
        `RECOVERING` (5): The agent is recovering.
        `FAILED` (6): The agent failed to execute.
- **agent_id** (string): Unique id of the agent instance

- If the returned status code is not `200`, the request failed. The response body includes the `detail` and `reason` for failure. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
      curl --request get \
      --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId \
      --header 'Authorization: Basic'
```

**Python**
```python
    import requests

    url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId"
    headers = {"Authorization": "Basic"}

    response = requests.get(url, headers=headers)
    print(response.text)
```

**Node.js**
```js
    const axios = require("axios");

    const url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId";
    const headers = { Authorization: "Basic" };

    axios.get(url, { headers })
      .then(response => console.log(response.data))
      .catch(error => console.error(error.response ? error.response.data : error.message));
```

## Response example

```json
  {
    "message": "agent exits with reason: xxxx",
    "start_ts": 1735035893,
    "stop_ts": 1735035900,
    "status": "FAILED",
    "name": "support_agent_001",
    "agent_id": "1NT29X11GQSxxxxxNU80BEIN56XF"
  }
  ```

------

---
title: Query conversation turn information
description: Query conversation turn information for a conversational AI agent session.
sidebar_position: 4.5
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/turns
exported_on: '2026-05-01T05:34:28.337184Z'
exported_file: turns.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/turns)

# Query conversation turn information


**Method:** GET
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}/turns`

After a conversation with the agent ends, use this endpoint to query the conversation turn information, including the start information, end information, and performance metrics of each conversation turn.
You can query sessions within the last 7 days.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
- **agentId** (string, required): The agent instance ID you obtained after successfully calling `join` to [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md).

## Response

- If the returned status code is `200`, the request was successful. 

  **response**

- **turns** (array): A list of conversation turns for the agent session.
  - **agent_id** (string): The unique identifier of the agent.
  - **channel** (string): The name of the RTC channel the agent joined.
  - **turn_id** (number): The sequential index of the turn within the session. Starts at `1`.
  - **start** (object): Details about the start of the turn.
    - **start_at** (number): The Unix timestamp in milliseconds (UTC time) when the turn started.
    - **type** (string, possible values: `voice_input`, `greeting`, `silence_timeout`, `api_speak`): The type of event that initiated the turn.

          - `voice_input`: The turn was initiated by user voice input.
          - `greeting`: The turn was initiated by an agent greeting.
          - `silence_timeout`: The turn was initiated due to a silence timeout.
          - `api_speak`: The turn was initiated by a call to the speak API.
    - **metadata** (object): Additional context about the turn start event. Included fields depend on the value of the `type` field.
      - **speech_duration_ms** (integer): The duration of the user's voice input in milliseconds. Included only when `type` is `voice_input`.
      - **interrupt_duration_ms** (integer): The minimum voice duration in milliseconds required to trigger an interruption. Included only when `type` is `voice_input`.
      - **greeting_nth** (integer): The index of the current greeting occurrence. Included only when `type` is `greeting`.
      - **action** (string): The action taken in response to the silence timeout. Included only when `type` is `silence_timeout`.

            - `speak`: Plays the silence prompt message to the user.
            - `think`: Appends the silence message to the conversation context and passes it to the LLM.
      - **transport** (string): The transport protocol used to deliver the speak request. Included only when `type` is `api_speak`.

            - `http`: Delivered over HTTP.
            - `rtm`: Delivered through the RTM Presence channel.
  - **end** (object): Details about the end of the turn.
    - **end_at** (number): The Unix timestamp in milliseconds (UTC time) when the turn ended.
    - **type** (string, possible values: `ok`, `interrupted`, `ignored`, `error`): The type of event that ended the turn. 

          - `ok`: The turn ended normally.
          - `interrupted`: The turn was interrupted.
          - `ignored`: The turn was ignored.
          - `error`: The turn ended due to an error.
    - **metadata** (object): Additional context about the turn end event. Included fields depend on the value of the `type` field.
      - **playback_duration_ms** (integer): The audio playback duration in milliseconds. Included only when `type` is `ok`.
      - **caused_by** (string): The cause of the turn ending.

            When `type` is `interrupted`, possible values are:
            - `start_of_speech`: A new voice input interrupted the turn.
            - `api_speak`: The turn was interrupted by a call to the speak API.
            - `api_interrupt`: The turn was interrupted by a call to the interrupt API.
            - `api_leave`: The turn was interrupted because the agent left the channel.

            When `type` is `ignored`, possible values are:
            - `semantic`: The turn was ignored because semantic end-of-speech detection determined no response was required. Applies when [`turn_detection.config.end_of_speech.mode`](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md) is set to `semantic`.
            - `keywords`: The turn was ignored because the start keyword was not detected. Applies when [`turn_detection.config.start_of_speech.mode`](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md) is set to `keywords`.
            - `disable`: The turn was ignored because interruption is disabled for this turn.
      - **transport** (string): The transport protocol used to deliver the request. Included only when `caused_by` is `api_speak` or `api_interrupt`.

            - `http`: Delivered over HTTP.
            - `rtm`: Delivered through the RTM Presence channel.
      - **reason** (string): The error type. Included only when `type` is `error`.

            - `LLM_REQUEST_ERR`: LLM request error.
            - `INTERNAL_ERR`: Internal error.
      - **details** (string): Additional error details. Included only when `type` is `error`.
  - **metrics** (object): Latency metrics for the turn.
    - **e2e_latency_ms** (integer): The end-to-end latency in milliseconds for the turn.
    - **segmented_latency_ms** (array): A breakdown of latency by segment.
      - **name** (string): The name of the latency segment.

            When the LLM input modality is `text`, the returned segments are:

            - `algorithm_processing`: Algorithm processing delay.
            - `asr_ttlw`: The ASR Time To Last Word (TTLW) in milliseconds. Represents the delay from when the user finishes speaking to when the ASR module outputs the last word.
            - `llm_ttft`: The LLM Time To First Token (TTFT) in milliseconds. Represents the delay from when the user finishes speaking to when the LLM outputs the first token.
            - `llm_ftfs`: The LLM First Token To First Sentence (FTFS) in milliseconds. Represents the delay from when the LLM outputs the first token to when it outputs the first complete sentence.
            - `tts_ttfb`: The TTS Time To First Byte (TTFB) in milliseconds. Represents the delay from when the TTS module receives a text request to when it outputs the first audio byte.
            - `transport`: Network transmission delay in milliseconds. Not returned when the user is connected using the RTC Web SDK.

            When the LLM input modality is `audio`, the returned segments are:

            - `algorithm_processing`: Algorithm processing delay.
            - `asr_ttlw`: The ASR Time To Last Word (TTLW) in milliseconds. Represents the delay from when the user finishes speaking to when the ASR module outputs the last word.
            - `llm_ttfa`: The LLM Time To First Audio Byte (TTFA) in milliseconds. Represents the delay from when the user finishes speaking to when the LLM outputs the first audio byte.
            - `transport`: Network transmission delay in milliseconds. Not returned when the user is connected using the RTC Web SDK.
      - **latency** (number): The latency in milliseconds for the segment.

- If the returned status code is not `200`, the request failed. The response body includes the error code and description. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
      curl --request GET \
        --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/turns \
        --header 'Authorization: Basic'
```

**Python**
```python
    import requests

    url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/turns"

    headers = {
        "Authorization": "Basic",
        "Content-Type": "application/json"
    }

    response = requests.get(url, headers=headers)
    print(response.text)
```

**Node.js**
```js
    const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/turns';

    const options = {
      method: 'GET',
      headers: {
        'Authorization': 'Basic',
        'Content-Type': 'application/json'
      }
    };

    fetch(url, options)
      .then(res => res.json())
      .then(json => console.log(json))
      .catch(err => console.error(err));
```

## Response example

```json
  {
    "turns": [
      {
        "agent_id": "A42Axxxxxxxxx37MT56J",
        "channel": "test_channel",
        "turn_id": 1,
        "start": {
          "start_at": 1774579820147,
          "type": "greeting",
          "metadata": {
            "greeting_nth": 1,
          }
        },
        "end": {
          "end_at": 1774579822412,
          "type": "interrupted",
          "metadata": {
            "caused_by": "api_interrupt",
            "transport": "rtm"
          }
        },
        "metrics": {
          "e2e_latency_ms": 337,
          "segmented_latency_ms": [
            {
              "name": "tts_ttfb",
              "latency": 337
            }
          ]
        }
      }
    ]
  }
  ```

-------

---
title: Retrieve a list of agents
description: Retrieve a list of agents that meet the specified conditions.
sidebar_position: 5
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/list
exported_on: '2026-05-01T05:34:27.323613Z'
exported_file: list.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/list)

# Retrieve a list of agents


**Method:** GET
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents`

Get a list of Conversational AI agents that meet the specified conditions.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
### Query parameters

- **channel** (string, optional): The channel to query for a list of agents.
- **from_time** (number, optional, default: 2 hours ago): The start timestamp (in seconds) for the query.
- **to_time** (number, optional, default: Current time): The end timestamp (in seconds) for the query.
- **state** (string, optional, default: 2): The agent state to filter by. Only one state can be specified per query:
    - `IDLE` (0): Agent is idle.
    - `STARTING` (1): The agent is being started.
    - `RUNNING` (2): The agent is running.
    - `STOPPING` (3): The agent is stopping.
    - `STOPPED` (4): The agent has exited.
    - `RECOVERING` (5): The agent is recovering.
    - `FAILED` (6): The agent failed to execute.
- **limit** (integer, optional, default: 20): The maximum number of entries returned per page.
- **cursor** (string, optional): The paging cursor, indicating the starting position (`agent_id`) of the next page of results.

## Response

- If the returned status code is `200`, the request was successful. The response body contains the result of the request.

  **OK**

- **data** (object): Agent data.
  - **count** (integer): The number of agents returned.
  - **list** (array): A list of agents that meets the criteria.
    - **start_ts** (integer): Agent creation timestamp.
    - **status** (string, possible values: `IDLE`, `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, `RECOVERING`, `FAILED`): The current state of the agent.
    - **agent_id** (string): The agent ID.
- **meta** (object): Returns meta information about the list.
  - **cursor** (string): Paging cursor.
  - **total** (integer): The total number of agents that meet the query conditions.
- **status** (string): Request status.

- If the returned status code is not `200`, the request failed. The response body includes the `detail` and `reason` for failure. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
      curl --request get \
        --url 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents?state=2&limit=20' \
        --header 'Authorization: Basic'
```

**Python**
```python
    import requests

    url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents'
    params = {
        'state': '2',
        'limit': '20'
    }
    headers = {
        'Authorization': 'Basic'
    }

    response = requests.get(url, headers=headers, params=params)

    print(response.status_code)
    print(response.json())  # Or response.text if it's not JSON
```

**Node.js**
```js
    const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents?state=2&limit=20';

    const options = {
      method: 'GET',
      headers: {
        'Authorization': 'Basic'
      }
    };

    fetch(url, options)
      .then(res => res.json())
      .then(json => console.log(json))
      .catch(err => console.error(err));
```

## Response example

```json
  {
    "data": {
      "count": 1,
      "list": [
        {
          "start_ts": 1735035893,
          "status": "RUNNING",
          "agent_id": "1234567890ABCDE1CVGZNU80BEIN56XF"
        }
      ]
    },
    "meta": {
      "cursor": "",
      "total": 1
    },
    "status": "ok"
  }
  ```


--------

---
title: Broadcast a message using TTS
description: Broadcast a custom message using the TTS module.
sidebar_position: 7
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/speak
exported_on: '2026-05-01T05:34:27.825884Z'
exported_file: speak.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/speak)

# Broadcast a message using TTS


**Method:** POST
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}/speak`

Use this endpoint to broadcast a custom message using the TTS module.

During a conversation with a Conversational AI agent, call this endpoint to immediately broadcast a custom message using the TTS module. Upon receiving the request, Conversational AI Engine interrupts the agent’s speech and thought process to deliver the message. This broadcast can be interrupted by human voice.
The speak API is not supported when using `mllm` configuration.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
- **agentId** (string, required): The agent instance ID you obtained after successfully calling `join` to [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md).
### Request body

APPLICATION/JSON
**BODY**

- **text** (string): The broadcast message text. The maximum length of the text content is 512 bytes.
- **priority** (string, possible values: `INTERRUPT`, `APPEND`, `IGNORE`): Sets the priority of the message broadcast.

    - `INTERRUPT`: High priority. The agent immediately interrupts the current interaction to announce the message.
    - `APPEND`: Medium priority. The agent announces the message after the current interaction ends.
    - `IGNORE`: Low priority. If the agent is busy interacting, it ignores and discards the broadcast; the message is only announced if the agent is not interacting.
- **interruptable** (boolean): Whether to allow users to interrupt the agent's broadcast by speaking:
    - `true`: Allow
    - `false`: Don't allow

## Response

- If the returned status code is `200`, the request was successful. The response body is empty, and the agent starts to broadcast the specified message.

  **OK**

- **agent_id** (string): Unique id of the agent instance.
- **channel** (integer): The name of the channel.
- **start_ts** (integer): Agent creation timestamp.    

- If the returned status code is not `200`, the request failed. The response body includes the error code and description. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
      curl --request post \
        --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/speak \
        --header 'Authorization: Basic' \
        --data '
      {
        "text": "Sorry, the conversation content is not compliant.",
        "priority": "INTERRUPT",
        "interruptable": false
      }'
```

**Python**
```python
    import requests

    url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/speak"

    payload = {
        "text": "Sorry, the conversation content is not compliant.",
        "priority": "INTERRUPT",
        "interruptable": False
    }
    headers = {"Authorization": "Basic"}

    response = requests.request("post", url, json=payload, headers=headers)

    print(response.text)
```

**Node.js**
```js
    const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/speak';
    const options = {
      method: 'post',
      headers: { Authorization: 'Basic' },
      body: JSON.stringify({
        text: 'Sorry, the conversation content is not compliant.',
        priority: 'INTERRUPT',
        interruptable: false
      })
    };

    fetch(url, options)
      .then(res => res.json())
      .then(json => console.log(json))
      .catch(err => console.error(err));
```

## Response example

```json
  {
    "agent_id": "1NT29XxxxxxxxxELWEHC8OS",
    "channel": "test_channel",
    "start_ts": 1744877089
  }
  ```

-----

---
title: Interrupt the agent
description: Interrupt an agent while speaking or thinking.
sidebar_position: 8
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/interrupt
exported_on: '2026-05-01T05:34:26.448760Z'
exported_file: interrupt.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/interrupt)

# Interrupt the agent


**Method:** POST
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}/interrupt`

Use this endpoint to interrupt the specified agent while speaking or thinking.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
- **agentId** (string, required): The agent instance ID you obtained after successfully calling `join` to [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md).
### Request body

APPLICATION/JSON
The request body is empty.

## Response

- If the returned status code is `200`, the request was successful. The response body contains agent information and the agent stops talking and thinking immediately.

- If the returned status code is not `200`, the request failed. The response body includes the error code and description. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
      curl --request post \
        --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/interrupt \
        --header 'Authorization: Basic' \
        --data '{}'
```

**Python**
```python
    import requests

    url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/interrupt"

    payload = {}
    headers = {"Authorization": "Basic"}

    response = requests.request("post", url, json=payload, headers=headers)

    print(response.text)
```

**Node.js**
```js
    const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/interrupt';
    const options = {
      method: 'post',
      headers: {Authorization: 'Basic'},
      body: JSON.stringify({})
    };

    fetch(url, options)
      .then(res => res.json())
      .then(json => console.log(json))
      .catch(err => console.error(err));
```

------

---
title: Retrieve agent history
description: Get the history of the conversation between the user and the agent.
sidebar_position: 9
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/agent/history
exported_on: '2026-05-01T05:34:26.194837Z'
exported_file: history.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/agent/history)

# Retrieve agent history


**Method:** GET
**Endpoint:** `https://api.agora.io/api/conversational-ai-agent/v2/projects/{appid}/agents/{agentId}/history`

Call this endpoint while the agent is running to retrieve the conversation history between the user and the Conversational AI agent.

## Request

### Path parameters

- **appid** (string, required): The App ID of the project.
- **agentId** (string, required): The agent instance ID you obtained after successfully calling `join` to [Start a conversational AI agent](https://docs-md.agora.io/en/conversational-ai/rest-api/agent/join.md).

## Response

- If the returned status code is `200`, the request was successful. The response body contains the result of the request.

  **OK**

- **agent_id** (string): Unique identifier of the agent.
- **start_ts** (integer): Agent creation timestamp.
- **status** (string, possible values: `RUNNING`): Agent status. Only supports querying the running agent.
- **contents** (array): Agent history.
  - **role** (string, possible values: `user`, `assistant`): The message sender.
        - `user`: User
        - `assistant`: AI agent
  - **content** (string): Message content.

- If the returned status code is not `200`, the request failed. The response body includes the error code and description. Refer to [status codes](https://docs-md.agora.io/en/conversational-ai/rest-api/reference.md) to understand the possible reasons for failure.

## Authorization

This endpoint requires [authentication](https://docs-md.agora.io/en/conversational-ai/rest-api/restful-authentication.md).

## Request example

**curl**
```bash
      curl --request get \
        --url https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/history \
        --header 'Authorization: Basic'
```

**Python**
```python
    import requests

    url = "https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/history"

    headers = {"Authorization": "Basic"}

    response = requests.request("get", url, headers=headers)

    print(response.text)
```

**Node.js**
```js
    const url = 'https://api.agora.io/api/conversational-ai-agent/v2/projects/:appid/agents/:agentId/history';
    const options = {method: 'get', headers: {Authorization: 'Basic'}};

    fetch(url, options)
      .then(res => res.json())
      .then(json => console.log(json))
      .catch(err => console.error(err));
```

## Response example

```json
  {
    "agent_id": "xxxx",
    "start_ts": 123,
    "status": "RUNNING",
    "contents": [
      {
        "role": "user",
        "content": "hello."
      },
      {
        "role": "assistant",
        "content": "hi, how can I help you?"
      }
    ]
  }
  ```

------

---
title: Status codes and error messages
description: Conversational AI Engine API response codes and status codes.
sidebar_position: 11
platform: android
exported_from: https://docs.agora.io/en/conversational-ai/rest-api/reference
exported_on: '2026-05-01T05:34:25.680566Z'
exported_file: reference.md
---

> For a complete site index fetch https://docs.agora.io/llms.txt. For all pages in this product fetch https://docs.agora.io/en/conversational-ai/overview/product-overview.md

[HTML Version](https://docs.agora.io/en/conversational-ai/rest-api/reference)

# Status codes and error messages

This page provides additional information you need to configure and troubleshoot Conversational AI Engine RESTful APIs.

## HTTP status codes

When calling the Conversational AI Engine RESTful API, you receive an HTTP status code.

- If the status code is `200`, it means the request is successful.

- If the status code is not `200`, the request failed. The response body contains `detail` and `reason` fields, that describe the specific reason for the failure.

Following is a sample response:

```json
// Status code 400: Request parameters are incorrect
{
  "detail": "create agent failed, code: 400, msg: properties: channel not found",
  "reason": "InvalidRequest"
}
```

| Response status code | Description   | Suggested action |
|:-------|:-------|:-----|
| `200` | OK | The request was successful. |
| `400`  | Invalid request parameters   | Check the `detail` field for specific information.  |
| `403`  | Unauthorized access | [Contact technical support](https://docs-md.agora.io/en/mailto:support@agora.io.md) to activate the service. |
| `404`  | Agent not found or has exited   | Check whether the task has been started successfully or has stopped.  |
| `409`  | Agent conflict | Use the already-started `agent_id` for subsequent update, query, and delete operations. |
| `422`  | Access limit exceeded   | [Contact technical support](https://docs-md.agora.io/en/mailto:support@agora.io.md) to raise your quota. |
| `502`  | Gateway error | [Contact technical support](https://docs-md.agora.io/en/mailto:support@agora.io.md). |
| `503`  | Agent startup failure | Retry using a backoff strategy.   |
| `504`  | Request timeout  | Retry using a backoff strategy.   |

The following table shows the possible `reason` values and descriptions. Use the `reason` and `detail` fields to troubleshoot the problem.

| reason | Description |
|:-----------------|:----------------------|
| `InternalError`   | Internal error on the server.   |
| `InvalidPermission`  | The service is not activated.   |
| `InvalidRequest`  | The request parameters are invalid.  |
| `ResourceQuotaLimitExceeded`  | Too many concurrent requests, exceeding the quota limit. |
| `ServiceUnavailable` | Internal error on the server.   |
| `TaskConflict`    | An agent with the same name already exists. |
| `TaskNotFound`    | The task was not started successfully, was aborted after starting, or has been destroyed. |
| `TaskOperationTimeout`    | Internal error on the server.  |
| `NotImplemented`  | Internal error on the server.   |