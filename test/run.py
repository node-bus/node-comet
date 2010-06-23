#!/usr/bin/env python
import webbrowser
import subprocess

def main():
    subprocess.Popen('sudo node testServer.js', shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    webbrowser.open('http://localhost:8080/test/')

if __name__ == '__main__':
    main()