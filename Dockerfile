FROM node:8-alpine
LABEL maintainer="spacemeowx2@gmail.com"

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories

RUN mkdir /code
WORKDIR /code
COPY ./package.json /code
RUN npm install

COPY . /code

CMD [ "npm", "start" ]
